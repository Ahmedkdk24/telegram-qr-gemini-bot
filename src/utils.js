// src/utils.js

export function logInfo(...args) {
  console.log(...args);
}

export function logWarn(...args) {
  console.warn(...args);
}

export function logError(...args) {
  console.error(...args);
}

export function safeJson(obj) {
  try {
    return JSON.stringify(obj);
  } catch (e) {
    return String(obj);
  }
}
