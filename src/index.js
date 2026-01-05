// src/index.js

import KVStore from './kv.js';
import route from './router.js';
import { logInfo, logWarn, logError } from './utils.js';

// --- Runtime bindings (initialized from `env` in the fetch handler) ---
let TOKEN;
const WEBHOOK = '/endpoint';
let SECRET;
let API_TOKEN;
const MODEL = 'gemini-2.0-flash';
const GENERATIVE_AI_REST_RESOURCE = 'generateContent';

/**
 * KV access will be provided by `KVStore` wrapper instance passed as `kv`.
 */

/**
 * Module fetch handler (receives `env` and `ctx` from Wrangler/runtime)
 */
export default {
  async fetch(request, env, ctx) {
    TOKEN = env?.TELEGRAM_TOKEN || TOKEN;
    SECRET = env?.TELEGRAM_SECRET || SECRET;
    API_TOKEN = env?.GOOGLE_API_KEY || API_TOKEN;

    logInfo('🔧 Bindings initialized ...');

    const kv = new KVStore(env?.EXERCISES_KV);

    // Handlers wrapper passed to router
    const handlers = {
      WEBHOOK_PATH: WEBHOOK,
      handleWebhook: (request, ctx) => handleWebhook(request, ctx, kv),
      registerWebhook: (request, env, url) => registerWebhook(request, env, url),
      unRegisterWebhook: () => unRegisterWebhook(),
      getAnswerKey: async (request, env, url) => {
        const id = url.searchParams.get('id');
        if (!id) return new Response('Missing id', { status: 400 });
        const data = await kv.getExercise(id);
        return new Response(JSON.stringify(data, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      },
      getSubmissions: async (request, env, url) => {
        const id = url.searchParams.get('id');
        if (!id) return new Response('Missing id', { status: 400 });
        const data = await kv.getSubmissions(id);
        if (!data) return new Response(`No submissions found for exercise ${id}`, { status: 404 });
        return new Response(JSON.stringify(data, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    };

    return route(request, env, ctx, handlers);
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

  if (message.photo || message.document?.mime_type?.startsWith('image/') || message.text) {
  return handleStudentSubmission(chatId, message.from, message, kv);
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
  console.log('📥 Processing PDF for exercise text');

  try {
    const pdfBase64 = await downloadTelegramFile(fileId);
    console.log(`📄 PDF downloaded, base64 length: ${pdfBase64.length}`);

    const prompt = `
Extract the readable text from this PDF.
Ignore formatting, and return ONLY plain text.
`;

    const geminiResult = await queryGemini([
      { text: prompt },
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64
        }
      }
    ]);

    const exerciseText = extractGeminiText(geminiResult).trim();
    if (!exerciseText) throw new Error('No text extracted from PDF');

    // Generate an exercise_id (could be timestamp-based)
    const exerciseId = Date.now().toString();

    // 1️⃣ Generate ANSWER KEY (ONCE per exercise)
    const answerKeyPrompt = `
    You are an English teacher.

    Extract ALL correct answers from this exercise.
    Return ONLY canonical correct answers.

    Rules:
    - No explanations
    - No student references
    - No paraphrasing
    - Output JSON ONLY

    Schema:
    {
      "<section_id>": {
        "<question_number>": "<correct_answer>"
      }
    }

    EXERCISE:
    ${exerciseText}
    `;

    const answerKeyResult = await queryGemini([{ text: answerKeyPrompt }]);
    const answerKeyText = extractGeminiText(answerKeyResult);
    const answerKeyJson = extractJsonFromMarkdown(answerKeyText);

    let answerKey;
    try {
      answerKey = JSON.parse(answerKeyJson);
    } catch (e) {
      throw new Error('Failed to parse answer key JSON');
    }

    // 2️⃣ Persist BOTH exercise + answer key
    await kv.setExercise(exerciseId, {
      text: exerciseText,
      answer_key: answerKey
    });

    await kv.setCurrentExerciseId(chatId, exerciseId);

    logInfo(`💾 Stored exercise ${exerciseId} text in KV`);
    return sendPlainText(chatId, `✅ Exercise ${exerciseId} saved successfully.`);
  } catch (error) {
    logError('❌ Error processing PDF:', error);
    return sendPlainText(chatId, '❌ Error processing PDF: ' + error.message);
  }
}


/**
 * ===== IMAGE → STUDENT SUBMISSION =====
 */
async function extractStudentAnswers(input, isImage = false) {
  console.log('🧠 Extracting student answers...');

  const parts = [{ text: 'Extract the text content (answers only) from this input. Return ONLY plain text — no JSON, no explanation.' }];

  if (isImage) {
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: input // base64 image
      }
    });
  } else {
    parts.push({ text: input }); // plain text from user message
  }

  const result = await queryGemini(parts);
  const extracted = extractGeminiText(result).trim();

  console.log(`📝 Extracted student text (${extracted.length} chars)`);
  return normalizeStudentAnswers(extracted);
}

/**
 * Normalize extracted student text:
 * - Lowercase
 * - Remove extra whitespace
 * - Keep punctuation minimal
 */
function normalizeStudentAnswers(text) {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[’‘]/g, "'")
    .trim();
}


async function handleStudentSubmission(chatId, from, message, kv) {
  logInfo('📥 Processing student submission');

  const CURRENT_EXERCISE_ID = await kv.getCurrentExerciseId(chatId);
  if (!CURRENT_EXERCISE_ID) {
    return sendPlainText(chatId, '⚠️ No exercise registered yet.');
  }
  const exercise = await kv.getExercise(CURRENT_EXERCISE_ID);

  if (!exercise.answer_key) {
    return sendPlainText(
      chatId,
      '⚠️ Answer key not found for this exercise.'
    );
  }

  if (!exercise?.text) {
    return sendPlainText(chatId, `⚠️ No exercise text found for ID ${CURRENT_EXERCISE_ID}.`);
  }

  try {
    let extractedAnswers = '';

    if (message.photo || message.document?.mime_type?.startsWith('image/')) {
      const fileId = message.photo
        ? message.photo.at(-1).file_id
        : message.document.file_id;
      const base64Image = await downloadTelegramFile(fileId, true);
      extractedAnswers = await extractStudentAnswers(base64Image, true);
    } else if (message.text) {
      extractedAnswers = await extractStudentAnswers(message.text, false);
    } else {
      return sendPlainText(chatId, '⚠️ Unsupported message type.');
    }

    const report = await gradeWithLLM(
      exercise.text,
      exercise.answer_key,
      extractedAnswers,
      CURRENT_EXERCISE_ID
    );


    console.log('📊 Grading complete');
    return sendPlainText(chatId, formatGradingReport(report));
  } catch (error) {
    logError('❌ Error processing student submission:', error);
    return sendPlainText(chatId, '❌ Error: ' + error.message);
  }
}


async function gradeWithLLM( exerciseText, answerKey, studentText, exerciseId) {
  console.log('🧮 Sending grading prompt to Gemini');
  
  // Log the inputs to see what's being sent
  console.log('=== EXERCISE TEXT (first 500 chars) ===');
  console.log(exerciseText.substring(0, 500));
  console.log('\n=== STUDENT ANSWERS ===');
  console.log(studentText);
  console.log('=======================\n');

  const prompt = `
You are an experienced English teacher grading past perfect exercises.

TASK:
Compare student answers with the answer key.

CORRECTNESS RULES:
- Focus ONLY on meaning (tense usage).
- Ignore spelling, punctuation, capitalization.
- Ignore minor grammar mistakes.
- If meaning matches → CORRECT.

IMPORTANT:
- Do NOT rewrite correct answers.
- Do NOT improve style.
- Do NOT penalize spelling.
- If a question is NOT answered by the student → IGNORE it.
- Only include corrections for answers with WRONG meaning.

OUTPUT:
- JSON ONLY.
- Full corrected sentences only.

Schema:
{
  "exercise_id": "...",
  "sections": {
    "<section_id>": {
      "all_correct": true | false,
      "corrections": {
        "<question_number>": "<full correct sentence>"
      }
    }
  }
}

ANSWER KEY:
${JSON.stringify(answerKey, null, 2)}

STUDENT ANSWERS:
${studentText}
`;


  console.log('=== PROMPT SENT TO GEMINI ===');
  console.log(prompt.substring(0, 1000));
  console.log('=============================\n');

  const result = await queryGemini([{ text: prompt }]);
  const geminiText = extractGeminiText(result);
  
  console.log('=== RAW GEMINI RESPONSE ===');
  console.log(geminiText);
  console.log('===========================\n');

  const cleanJson = extractJsonFromMarkdown(geminiText);
  
  console.log('=== CLEANED JSON ===');
  console.log(cleanJson);
  console.log('====================\n');

  try {
    const report = JSON.parse(cleanJson);
    console.log('=== PARSED REPORT ===');
    console.log(JSON.stringify(report, null, 2));
    console.log('====================\n');
    
    // Validate the structure
    if (!report.sections) {
      console.error('❌ Missing "sections" in report');
      throw new Error('Invalid report structure: missing sections');
    }
    
    return report;
  } catch (err) {
    console.error('❌ JSON parse error:', err.message);
    console.error('Failed JSON:', cleanJson);
    throw new Error('Gemini returned invalid JSON');
  }
}


// Submissions are handled by KVStore.getSubmissions



/**
 * ===== REPORT BUILDER =====
 */

function formatGradingReport(report) {
  let text = '';

  for (const [section, result] of Object.entries(report.sections)) {
    if (result.all_correct) {
      text += `${section} ✅✅✅\n\n`;
    } else {
      text += `${section}\n`;
      for (const [q, ans] of Object.entries(result.corrections || {})) {
        text += `${q}. ${ans}\n`;
      }
      text += `The rest ✅✅✅\n\n`;
    }
  }

  return text.trim();
}


/**
 * ===== TELEGRAM HELPERS =====
 */
async function downloadTelegramFile(fileId, isImage = false) {
  logInfo(`📥 Downloading file: ${fileId}`);

  const meta = await fetch(apiUrl('getFile', { file_id: fileId })).then(r => r.json());
  if (!meta.ok) {
    throw new Error(`Telegram API error: ${JSON.stringify(meta)}`);
  }

  const filePath = meta.result.file_path;
  logInfo(`📁 File path: ${filePath}`);

  const file = await fetch(`https://api.telegram.org/file/bot${TOKEN}/${filePath}`);
  const buf = await file.arrayBuffer();
  logInfo(`✅ Downloaded ${buf.byteLength} bytes`);

  // Inline arrayBuffer -> base64 conversion (small helper used only here)
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000; // 32KB chunks
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

function apiUrl(method, params = {}) {
  return `https://api.telegram.org/bot${TOKEN}/${method}?${new URLSearchParams(params)}`;
}

async function sendPlainText(chatId, text) {
  logInfo(`💬 Sending message to ${chatId}: ${text.substring(0, 100)}...`);
  try {
    const response = await fetch(apiUrl('sendMessage', { chat_id: chatId, text }));
    const result = await response.json();
    if (!result.ok) {
      logError('❌ Telegram send error:', JSON.stringify(result));
    } else {
      logInfo('✅ Message sent successfully');
    }
    return result;
  } catch (error) {
    logError('❌ Error sending message:', error);
    throw error;
  }
}

// arrayBufferToBase64 inlined inside downloadTelegramFile

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