// src/kv.js
import { logInfo, logWarn, logError, safeJson } from './utils.js';

export default class KVStore {
  constructor(binding) {
    this.binding = binding;
  }

  async getExercise(exerciseId) {
    try {
      if (!this.binding) {
        logWarn('⚠️ KV binding not available, returning null');
        return null;
      }
      const data = await this.binding.get(`exercise:${exerciseId}`, 'json');
      logInfo(`📦 KV.get(exercise:${exerciseId}) returned:`, data ? 'found' : 'null');
      return data || null;
    } catch (err) {
      logError('❌ KV.get error:', err);
      return null;
    }
  }

  async setExercise(exerciseId, answerKey) {
    try {
      if (!this.binding) {
        logWarn('⚠️ KV binding not available, skipping write');
        return;
      }
      await this.binding.put(`exercise:${exerciseId}`, JSON.stringify(answerKey));
      logInfo(`📦 KV.put(exercise:${exerciseId}) succeeded`);
    } catch (err) {
      logError('❌ KV.put error:', err);
    }
  }

  async getCurrentExerciseId(chatId) {
    try {
      if (!this.binding) {
        logWarn('⚠️ KV binding not available, returning null');
        return null;
      }
      const id = await this.binding.get(`chat:${chatId}:current_exercise`, 'text');
      logInfo(`📦 KV.get(chat:${chatId}:current_exercise) returned:`, id || 'null');
      return id || null;
    } catch (err) {
      logError('❌ KV.get error:', err);
      return null;
    }
  }

  async setCurrentExerciseId(chatId, exerciseId) {
    try {
      if (!this.binding) {
        logWarn('⚠️ KV binding not available, skipping write');
        return;
      }
      await this.binding.put(`chat:${chatId}:current_exercise`, exerciseId);
      logInfo(`📦 KV.put(chat:${chatId}:current_exercise) = ${exerciseId} succeeded`);
    } catch (err) {
      logError('❌ KV.put error:', err);
    }
  }

  async getSubmissions(exerciseId) {
    try {
      if (!this.binding) {
        logWarn('⚠️ KV not available, returning empty submissions');
        return {};
      }
      const data = await this.binding.get(`submissions:${exerciseId}`, 'json');
      logInfo(`📦 KV.get(submissions:${exerciseId}) returned:`, data ? 'found' : 'null');
      return data || {};
    } catch (err) {
      logError('❌ KV.get submissions error:', err);
      return {};
    }
  }
}
