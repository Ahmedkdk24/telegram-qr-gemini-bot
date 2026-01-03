// src/index.js

// --- Constants from environment variables ---
const TOKEN = TELEGRAM_TOKEN;
const WEBHOOK = '/endpoint';
const SECRET = TELEGRAM_SECRET;
const API_TOKEN = GOOGLE_API_KEY;
const MODEL = 'gemini-2.5-flash-lite'; // Note: Gemini 2.0 is the current stable version
const GENERATIVE_AI_REST_RESOURCE = 'generateContent';

const GEMINI_API_ENDPOINT = `https://generativelanguage.googleapis.com/v1/models/${MODEL}:${GENERATIVE_AI_REST_RESOURCE}?key=${API_TOKEN}`;

console.log(`🤖 Bot configured with ${MODEL}`);

/**
 * Cloudflare Worker fetch event handler
 */
addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname === WEBHOOK) {
    event.respondWith(handleWebhook(event));
  } else if (url.pathname === '/registerWebhook') {
    event.respondWith(registerWebhook(event, url, WEBHOOK, SECRET));
  } else if (url.pathname === '/unRegisterWebhook') {
    event.respondWith(unRegisterWebhook());
  } else {
    event.respondWith(new Response('No handler for this request'));
  }
});

/**
 * Handle Telegram webhook events
 */
async function handleWebhook(event) {
  if (event.request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }

  try {
    const update = await event.request.json();
    event.waitUntil(onUpdate(update));
    return new Response('Ok');
  } catch (err) {
    return new Response('Bad Request', { status: 400 });
  }
}

async function onUpdate(update) {
  if ('message' in update) {
    await onMessage(update.message);
  }
}

async function onMessage(message) {
  const chatId = message.chat.id;

  if (message.text) {
    return handleText(chatId, message.text);
  } else if (message.photo || (message.document && message.document.mime_type?.startsWith('image/'))) {
    const fileId = message.photo
      ? message.photo[message.photo.length - 1].file_id
      : message.document.file_id;
    return handleImage(chatId, fileId);
  } else {
    return sendPlainText(chatId, '📝 I can only process text and images.');
  }
}

/**
 * Core Gemini API Caller
 */
async function queryGemini(contents) {
  const response = await fetch(GEMINI_API_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: contents }]
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status} - ${JSON.stringify(data)}`);
  }
  return data;
}

async function handleText(chatId, text) {
  try {
    const geminiResult = await queryGemini([{ text }]);
    const replyText = extractGeminiText(geminiResult);
    return sendPlainText(chatId, replyText);
  } catch (error) {
    return sendPlainText(chatId, '😔 Error connecting to AI. Try again.');
  }
}

async function handleImage(chatId, fileId) {
  try {
    const fileMetaRes = await fetch(apiUrl('getFile', { file_id: fileId }));
    const fileMetaData = await fileMetaRes.json();
    if (!fileMetaData.ok) throw new Error("Failed to get file metadata");

    const filePath = fileMetaData.result.file_path;
    const fileUrl = `https://api.telegram.org/file/bot${TOKEN}/${filePath}`;

    const imageResp = await fetch(fileUrl);
    const arrayBuffer = await imageResp.arrayBuffer();
    
    const base64Image = arrayBufferToBase64(arrayBuffer);
    const mimeType = await detectMimeType(arrayBuffer, filePath);

    // Gemini requires a text part alongside the image part for context
    const geminiResult = await queryGemini([
      { text: "What is in this image? Provide a detailed description." },
      {
        inlineData: {
          mimeType: mimeType,
          data: base64Image
        }
      }
    ]);

    return sendPlainText(chatId, extractGeminiText(geminiResult));
  } catch (error) {
    return sendPlainText(chatId, '🖼️ Error: ' + error.message);
  }
}

/**
 * Helper Utilities
 */
function apiUrl(method, params = {}) {
  const query = new URLSearchParams(params).toString();
  return `https://api.telegram.org/bot${TOKEN}/${method}${query ? '?' + query : ''}`;
}

async function sendPlainText(chatId, text) {
  return fetch(apiUrl('sendMessage', {
    chat_id: chatId,
    text: text
  }));
}

async function detectMimeType(arrayBuffer, filePath) {
  const bytes = new Uint8Array(arrayBuffer.slice(0, 4));
  // Magic bytes check
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[0] === 0x52 && bytes[1] === 0x49) return 'image/webp';
  
  // Strict fallback: Gemini rejects application/octet-stream
  return 'image/jpeg'; 
}

function extractGeminiText(result) {
  return result.candidates?.[0]?.content?.parts?.[0]?.text || '🤖 No reply.';
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Webhook Registration Helpers
 */
async function registerWebhook(event, url, WEBHOOK, SECRET) {
  const webhookUrl = `${url.protocol}//${url.hostname}${WEBHOOK}`;
  const r = await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: SECRET }));
  return new Response(JSON.stringify(await r.json()), { headers: { 'content-type': 'application/json' } });
}

async function unRegisterWebhook() {
  const r = await fetch(apiUrl('setWebhook', { url: '' }));
  return new Response(JSON.stringify(await r.json()), { headers: { 'content-type': 'application/json' } });
}