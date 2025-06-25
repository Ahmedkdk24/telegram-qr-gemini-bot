const TOKEN = TELEGRAM_TOKEN;// Obtain from @Botfather
const WEBHOOK = '/endpoint';
const SECRET = TELEGRAM_SECRET; // Create on Cloudflare Dashboard
const api_token = GOOGLE_API_KEY; // Obtain from Google Studio
const account_id = ACCOUNT_ID; //Cloudflare Account ID
const gateway_name = GATEWAY_NAME; // Cloudflare AI Gateway ID
const model = 'gemini-1.5-flash'; 
const generative_ai_rest_resource = 'generateContent';

const GEMENI_API_ENDPOINT = `https://gateway.ai.cloudflare.com/v1/${account_id}/${gateway_name}/google-ai-studio/v1/models/${model}:${generative_ai_rest_resource}`;

/**
 * Wait for requests to the worker
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook(event));
  } else {
    event.respondWith(new Response('No handler for this request'));
  }
});

/**
 * Handle requests to WEBHOOK
 */
async function handleWebhook(event) {
  // Check secret
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }

  // Read request body
  const update = await event.request.json();
  // Process update
  event.waitUntil(onUpdate(update));

  return new Response('Ok');
}

/**
 * Handle incoming Update
 */
async function onUpdate(update) {
  if ('message' in update) {
    await onMessage(update.message);
  }
}

/**
 * Handle incoming Message
 */
async function onMessage(message) {
  console.log("📩 Full message object:", JSON.stringify(message, null, 2));

  if (message.text) {
    return handleText(message.chat.id, message.text);
  } else if (message.photo || (message.document && message.document.mime_type.startsWith('image/'))) {
    const fileId = message.photo 
      ? message.photo[message.photo.length - 1].file_id 
      : message.document.file_id;

    return handleImage(message.chat.id, fileId);
  } else {
    return sendPlainText(message.chat.id, '📝 I can only process text messages and images for now.');
  }
}

async function handleText(chatId, text) {
  try {
    const geminiResult = await queryGemini([{ text }]);
    const replyText = extractGeminiText(geminiResult);
    return sendPlainText(chatId, replyText);
  } catch (error) {
    console.error("⚠️ Gemini processing error:", error);
    return sendPlainText(chatId, '😔 Sorry, something went wrong. Please try again later.');
  }
}

async function handleImage(chatId, fileId) {
  try {
    const fileMetaRes = await fetch(apiUrl('getFile', { file_id: fileId }));
    const fileMetaData = await fileMetaRes.json();
    if (!fileMetaData.ok) throw new Error("Failed to get file path from Telegram");

    const filePath = fileMetaData.result.file_path.trim();
    const encodedFilePath = encodeURIComponent(filePath).replace(/%2F/g, '/');
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${encodedFilePath}`;

    const imageResp = await fetch(fileUrl);
    let mimeType = imageResp.headers.get("content-type");

    if (!mimeType || mimeType === "application/octet-stream") {
      if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) mimeType = 'image/jpeg';
      else if (filePath.endsWith('.png')) mimeType = 'image/png';
      else if (filePath.endsWith('.webp')) mimeType = 'image/webp';
      else throw new Error(`Unsupported image type: ${filePath}`);
    }

    const arrayBuffer = await imageResp.arrayBuffer();
    if (arrayBuffer.byteLength > 16 * 1024 * 1024) {
      throw new Error("Image too large for processing.");
    }

    const base64Image = arrayBufferToBase64(arrayBuffer);

    // Step 1: Get Gemini response
    const geminiResult = await queryGemini([
      {
        inlineData: {
          mimeType,
          data: base64Image
        }
      }
    ]);
    const geminiText = extractGeminiText(geminiResult);

    // Step 2: Try QR decoding
    const qrDecoded = await tryDecodeQrCodeBase64(arrayBuffer);
    const qrText = qrDecoded ? `\n\n🔍 QR Code Result:\n${qrDecoded}` : '';

    // Step 3: Send combined reply
    const finalReply = `${geminiText}${qrText}`;
    return sendPlainText(chatId, finalReply);

  } catch (error) {
    console.error("⚠️ Image processing error:", error);
    return sendPlainText(chatId, '🖼️ Could not process the image. Try again with a clear photo under 16MB.');
  }
}




// Modified sendPlainText with retry support
async function sendPlainText(chatId, text) {
  return retry(async () => {
    const response = await fetch(apiUrl('sendMessage', {
      chat_id: chatId,
      text
    }));

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status} - ${await response.text()}`);
    }

    return await response.json();
  });
}


/**
 * Construct Telegram API URL
 */
function apiUrl(method, params) {
  const query = new URLSearchParams(params).toString();
  return `https://api.telegram.org/bot${TOKEN}/${method}?${query}`;
}

/**
 * Set webhook to this worker's URL
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
  const r = await (await fetch(apiUrl('setWebhook', {
    url: webhookUrl,
    secret_token: secret
  }))).json();
  return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
}

// Modified sendPlainText with retry support
async function sendPlainText(chatId, text) {
  return retry(async () => {
    const response = await fetch(apiUrl('sendMessage', {
      chat_id: chatId,
      text
    }));

    if (!response.ok) {
      throw new Error(`Telegram API error: ${response.status} - ${await response.text()}`);
    }

    return await response.json();
  });
}

// Utility: Retry helper with exponential backoff
async function retry(fn, retries = 3, delay = 500) {
  try {
    return await fn();
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(res => setTimeout(res, delay));
    return retry(fn, retries - 1, delay * 2);
  }
}

async function getTelegramFileUrl(fileId) {
  const res = await fetch(apiUrl('getFile', { file_id: fileId }));
  const data = await res.json();
  if (!data.ok) throw new Error("Failed to get file path from Telegram");
  const filePath = data.result.file_path;
  return `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;
}

async function queryGemini(parts) {
  const response = await fetch(`${GEMENI_API_ENDPOINT}?key=${api_token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }]
    })
  });

  const text = await response.text();
  console.log("Gemini raw response:", text);

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} - ${text}`);
  }

  return JSON.parse(text);
}

function extractGeminiText(result) {
  try {
    return result.candidates?.[0]?.content?.parts?.[0]?.text || '🤖 No reply.';
  } catch (err) {
    console.error("Reply extract error:", err);
    return '🤖 Gemini replied, but something went wrong reading it.';
  }
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function tryDecodeQrCodeBase64(imageBuffer) {
  const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';

  const blob = new Blob([
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="file"; filename="image.jpg"\r\n`,
    `Content-Type: image/jpeg\r\n\r\n`,
    new Uint8Array(imageBuffer), `\r\n`,
    `--${boundary}--`
  ]);

  try {
    const response = await fetch('https://api.qrserver.com/v1/read-qr-code/', {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: blob
    });

    const result = await response.json();
    console.log("📦 QR decode result:", JSON.stringify(result, null, 2));
    const decodedText = result?.[0]?.symbol?.[0]?.data;
    return decodedText || null;

  } catch (error) {
    console.error("QR decoding error:", error);
    return null;
  }
}