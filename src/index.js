// src/index.js

// --- Runtime bindings (initialized from `env` in the fetch handler) ---
let TOKEN;
const WEBHOOK = '/endpoint';
let SECRET;
let API_TOKEN;
const MODEL = 'gemini-2.5-flash-lite';
const GENERATIVE_AI_REST_RESOURCE = 'generateContent';

/**
 * In-memory fallback stores (will use KV for persistence)
 */
const SUBMISSIONS = {};        // { exerciseId: { studentId: submission } }

/**
 * KV helpers for exercises
 */
async function getExerciseFromKV(kv, exerciseId) {
  try {
    if (!kv) {
      console.log('⚠️ KV binding not available, returning null');
      return null;
    }
    const data = await kv.get(`exercise:${exerciseId}`, 'json');
    console.log(`📦 KV.get(exercise:${exerciseId}) returned:`, data ? 'found' : 'null');
    return data || null;
  } catch (err) {
    console.error('❌ KV.get error:', err);
    return null;
  }
}

async function setExerciseInKV(kv, exerciseId, answerKey) {
  try {
    if (!kv) {
      console.log('⚠️ KV binding not available, skipping write');
      return;
    }
    await kv.put(`exercise:${exerciseId}`, JSON.stringify(answerKey));
    console.log(`📦 KV.put(exercise:${exerciseId}) succeeded`);
  } catch (err) {
    console.error('❌ KV.put error:', err);
  }
}

async function getCurrentExerciseId(kv, chatId) {
  try {
    if (!kv) {
      console.log('⚠️ KV binding not available, returning null');
      return null;
    }
    const id = await kv.get(`chat:${chatId}:current_exercise`, 'text');
    console.log(`📦 KV.get(chat:${chatId}:current_exercise) returned:`, id || 'null');
    return id || null;
  } catch (err) {
    console.error('❌ KV.get error:', err);
    return null;
  }
}

async function setCurrentExerciseId(kv, chatId, exerciseId) {
  try {
    if (!kv) {
      console.log('⚠️ KV binding not available, skipping write');
      return;
    }
    await kv.put(`chat:${chatId}:current_exercise`, exerciseId);
    console.log(`📦 KV.put(chat:${chatId}:current_exercise) = ${exerciseId} succeeded`);
  } catch (err) {
    console.error('❌ KV.put error:', err);
  }
}

/**
 * Module fetch handler (receives `env` and `ctx` from Wrangler/runtime)
 */
export default {
  async fetch(request, env, ctx) {
    // Always ensure bindings are initialized from env for this request
    TOKEN = env?.TELEGRAM_TOKEN || TOKEN;
    SECRET = env?.TELEGRAM_SECRET || SECRET;
    API_TOKEN = env?.GOOGLE_API_KEY || API_TOKEN;
    
    console.log(`🔧 Bindings initialized - TOKEN: ${TOKEN ? '✓' : '✗'}, SECRET: ${SECRET ? '✓' : '✗'}, API_TOKEN: ${API_TOKEN ? '✓' : '✗'}`);

    const url = new URL(request.url);
    console.log(`🌐 Received request: ${url.pathname}`);

    if (url.pathname === WEBHOOK) {
      return handleWebhook(request, ctx, env?.EXERCISES_KV);
    } else if (url.pathname === '/registerWebhook') {
      return registerWebhook(request, env, url);
    } else if (url.pathname === '/unRegisterWebhook') {
      return unRegisterWebhook();
    } else {
      return new Response('No handler for this request');
    }
  }
};

/**
 * Webhook security
 */
async function handleWebhook(request, ctx, kv) {
  console.log('🔐 Webhook received');

  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    console.log('❌ Unauthorized webhook attempt');
    return new Response('Unauthorized', { status: 403 });
  }

  try {
    const update = await request.json();
    console.log('📩 Telegram update:', JSON.stringify(update).substring(0, 500));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(onUpdate(update, kv));
    else onUpdate(update, kv);
    return new Response('Ok');
  } catch (error) {
    console.error('❌ Error parsing webhook:', error);
    return new Response('Error', { status: 500 });
  }
}

async function onUpdate(update, kv) {
  console.log('🔄 Processing update');
  if (!update.message) {
    console.log('⚠️ Update has no message');
    return;
  }
  return onMessage(update.message, kv);
}

/**
 * Message router
 */
async function onMessage(message, kv) {
  const chatId = message.chat.id;
  const userName = message.from?.first_name || 'Unknown';
  console.log(`👤 Message from ${userName} (chat: ${chatId})`);

  if (message.document?.mime_type === 'application/pdf') {
    console.log('📄 PDF document received');
    return handleExercisePdf(chatId, message.document.file_id, kv);
  }

  if (message.photo || message.document?.mime_type?.startsWith('image/')) {
    console.log('🖼️ Image received');
    const fileId = message.photo
      ? message.photo.at(-1).file_id
      : message.document.file_id;
    return handleStudentImage(chatId, message.from, fileId, kv);
  }

  console.log('📝 Plain text message');
  return sendPlainText(chatId, '📝 Send the exercise PDF or student answer images.');
}

/**
 * ===== GEMINI CORE =====
 */
async function queryGemini(parts) {
  console.log('🚀 Calling Gemini API...');
  
  // Build the endpoint URL HERE, after API_TOKEN is loaded
  if (!API_TOKEN) {
    throw new Error('API_TOKEN not initialized');
  }
  
  const GEMINI_API_ENDPOINT = 
    `https://generativelanguage.googleapis.com/v1/models/${MODEL}:${GENERATIVE_AI_REST_RESOURCE}?key=${API_TOKEN}`;
  
  console.log(`🔑 Using API token: ${API_TOKEN.substring(0, 10)}...`);
  
  try {
    const payload = {
      contents: [{ parts }],
      generationConfig: {
        temperature: 0
      }
    };
    
    const response = await fetch(GEMINI_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log(`📊 Gemini response status: ${response.status}`);
    
    if (!response.ok) {
      console.error('❌ Gemini API error:', JSON.stringify(data));
      throw new Error(`Gemini API error: ${response.status}`);
    }
    
    console.log('✅ Gemini response received');
    return data;
  } catch (error) {
    console.error('❌ Error calling Gemini:', error);
    throw error;
  }
}

function extractGeminiText(result) {
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log(`📝 Extracted Gemini text length: ${text.length} chars`);
  return text;
}

function extractJsonFromMarkdown(text) {
  // Strip markdown code fences if present (e.g., ```json ... ```)
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return text.trim();
}

/**
 * ===== PDF → ANSWER KEY =====
 */
async function handleExercisePdf(chatId, fileId, kv) {
  console.log('📥 Processing PDF for answer key');
  
  try {
    const pdfBase64 = await downloadTelegramFile(fileId);
    console.log(`📄 PDF downloaded, base64 length: ${pdfBase64.length}`);

    const prompt = `
You are an English teacher assistant.
Extract ONLY the correct answers for exercise 73.
Return JSON ONLY.

Format:
{
 "exercise_id":"73",
 "sections":{
   "73.1":{"categories":{...}},
   "73.2":{"answers":{...}},
   "73.3":{"answers":{...},"lexical_invalid":["full days"]}
 }
}
Lowercase everything.
No explanations.
`;

    console.log('🧠 Sending PDF to Gemini...');
    const geminiResult = await queryGemini([
      { text: prompt },
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64
        }
      }
    ]);

    const geminiText = extractGeminiText(geminiResult);
    console.log('📋 Gemini raw response:', geminiText.substring(0, 500));
    
    const cleanJson = extractJsonFromMarkdown(geminiText);
    const answerKey = JSON.parse(cleanJson);
    console.log(`✅ Parsed answer key for exercise: ${answerKey.exercise_id}`);

    await setExerciseInKV(kv, answerKey.exercise_id, answerKey);
    await setCurrentExerciseId(kv, chatId, answerKey.exercise_id);

    console.log(`💾 Stored exercise ${answerKey.exercise_id} in KV`);
    return sendPlainText(
      chatId,
      `✅ Exercise ${answerKey.exercise_id} registered.\nAnswer key created.`
    );
  } catch (error) {
    console.error('❌ Error processing PDF:', error);
    return sendPlainText(chatId, '❌ Error processing PDF: ' + error.message);
  }
}

/**
 * ===== IMAGE → STUDENT SUBMISSION =====
 */
async function handleStudentImage(chatId, from, fileId, kv) {
  console.log('📥 Processing student image');
  
  const CURRENT_EXERCISE_ID = await getCurrentExerciseId(kv, chatId);
  if (!CURRENT_EXERCISE_ID) {
    console.log('⚠️ No exercise registered');
    return sendPlainText(chatId, '⚠️ No exercise registered yet.');
  }

  try {
    const base64Image = await downloadTelegramFile(fileId, true);
    console.log(`🖼️ Image downloaded, base64 length: ${base64Image.length}`);

    const prompt = `
Extract ONLY the student's answers.
No corrections.
Return JSON ONLY.

Format:
{
 "sections":{
   "73.1":{...},
   "73.2":{...},
   "73.3":{...}
 }
}
`;

    console.log('🧠 Sending image to Gemini...');
    const geminiResult = await queryGemini([
      { text: prompt },
      {
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Image
        }
      }
    ]);

    const geminiText = extractGeminiText(geminiResult);
    console.log('📋 Gemini raw response:', geminiText.substring(0, 500));
    
    const cleanJson = extractJsonFromMarkdown(geminiText);
    const submission = JSON.parse(cleanJson);
    const studentId = from.id;
    
    console.log(`👨‍🎓 Student ${studentId} submission extracted`);
    SUBMISSIONS[CURRENT_EXERCISE_ID][studentId] = submission;

    const answerKey = await getExerciseFromKV(kv, CURRENT_EXERCISE_ID);
    if (!answerKey) {
      throw new Error('Answer key not found in KV');
    }

    const report = gradeSubmission(submission, answerKey);

    console.log('📊 Grading complete');
    return sendPlainText(chatId, buildReport(report));
  } catch (error) {
    console.error('❌ Error processing image:', error);
    return sendPlainText(chatId, '❌ Error processing image: ' + error.message);
  }
}

/**
 * ===== GRADING ENGINE =====
 */
function normalize(s) {
  return s.toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
}

function gradeSubmission(sub, key) {
  console.log('📝 Grading submission...');
  return {
    '73.1': grade731(sub.sections?.['73.1'], key.sections['73.1']),
    '73.2': grade732(sub.sections?.['73.2'], key.sections['73.2']),
    '73.3': grade733(sub.sections?.['73.3'], key.sections['73.3'])
  };
}

function grade731(student, key) {
  console.log('📊 Grading section 73.1');
  const errors = [];
  if (!student) {
    console.log('⚠️ No student data for 73.1');
    return errors;
  }

  for (const [cat, items] of Object.entries(student)) {
    for (const item of items) {
      const n = normalize(item);
      for (const [correctCat, correctItems] of Object.entries(key.categories)) {
        if (correctItems.includes(n) && correctCat !== cat && n === 'chest of drawers') {
          errors.push("We don't wear chest of drawers ❌");
        }
      }
    }
  }
  console.log(`✅ 73.1 errors: ${errors.length}`);
  return errors;
}

function grade732(student, key) {
  console.log('📊 Grading section 73.2');
  const wrong = [];
  if (!student) {
    console.log('⚠️ No student data for 73.2');
    return wrong;
  }

  for (const [q, ans] of Object.entries(student)) {
    if (!key.answers[q].includes(normalize(ans))) {
      wrong.push(`${q}.${ans}`);
    }
  }
  console.log(`✅ 73.2 wrong answers: ${wrong.length}`);
  return wrong;
}

function grade733(student, key) {
  console.log('📊 Grading section 73.3');
  const notes = [];
  if (!student) {
    console.log('⚠️ No student data for 73.3');
    return notes;
  }

  for (const [q, ans] of Object.entries(student)) {
    if (key.lexical_invalid.includes(normalize(ans))) {
      notes.push(
        `1. Bus stop / full-time\n( ${ans} is not a real English word❌)`
      );
    }
  }
  console.log(`✅ 73.3 notes: ${notes.length}`);
  return notes;
}

/**
 * ===== REPORT BUILDER =====
 */
function buildReport(r) {
  console.log('📈 Building report...');
  return `
73.1
${r['73.1'].join('\n')}
الباقي✅✅✅

73.2
${r['73.2'].join('\n')}
الباقي✅✅✅

73.3
${r['73.3'].join('\n')}
الباقي✅✅✅
`.trim();
}

/**
 * ===== TELEGRAM HELPERS =====
 */
async function downloadTelegramFile(fileId, isImage = false) {
  console.log(`📥 Downloading file: ${fileId}`);
  
  const meta = await fetch(apiUrl('getFile', { file_id: fileId })).then(r => r.json());
  if (!meta.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(meta)}`);
  }
  
  const filePath = meta.result.file_path;
  console.log(`📁 File path: ${filePath}`);
  
  const file = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`);
  const buf = await file.arrayBuffer();
  console.log(`✅ Downloaded ${buf.byteLength} bytes`);
  
  return arrayBufferToBase64(buf);
}

function apiUrl(method, params = {}) {
  return `https://api.telegram.org/bot${TOKEN}/${method}?${new URLSearchParams(params)}`;
}

async function sendPlainText(chatId, text) {
  console.log(`💬 Sending message to ${chatId}: ${text.substring(0, 100)}...`);
  try {
    const response = await fetch(apiUrl('sendMessage', { chat_id: chatId, text }));
    const result = await response.json();
    if (!result.ok) {
      console.error('❌ Telegram send error:', JSON.stringify(result));
    } else {
      console.log('✅ Message sent successfully');
    }
    return result;
  } catch (error) {
    console.error('❌ Error sending message:', error);
    throw error;
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    // use apply on small chunks to avoid spreading a huge array into the call
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

/**
 * Webhook management
 */
async function registerWebhook(request, env, url) {
  console.log('🔗 Registering webhook...');
  if (!SECRET && env) SECRET = env.TELEGRAM_SECRET;
  const webhookUrl = `${url.protocol}//${url.hostname}${WEBHOOK}`;
  console.log(`🌐 Webhook URL: ${webhookUrl}`);

  const r = await fetch(apiUrl('setWebhook', {
    url: webhookUrl,
    secret_token: SECRET
  }));
  return new Response(JSON.stringify(await r.json()));
}

async function unRegisterWebhook() {
  console.log('🔓 Unregistering webhook...');
  const r = await fetch(apiUrl('deleteWebhook'));
  return new Response(JSON.stringify(await r.json()));
}