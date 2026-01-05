// src/router.js
import { logInfo, logWarn, logError } from './utils.js';

export default async function route(request, env, ctx, handlers) {
  const url = new URL(request.url);
  const path = url.pathname || '/';
  logInfo(`🌐 Routing request: ${path}`);

  switch (true) {
    case path === handlers.WEBHOOK_PATH:
      return handlers.handleWebhook(request, ctx, env?.EXERCISES_KV);

    case path === '/registerWebhook':
      return handlers.registerWebhook(request, env, url);

    case path === '/unRegisterWebhook':
      return handlers.unRegisterWebhook(request, env, url);

    case path.startsWith('/getAnswerKey'):
      return handlers.getAnswerKey(request, env, url);

    case path.startsWith('/getSubmissions'):
      return handlers.getSubmissions(request, env, url);

    default:
      logWarn('No handler for path', path);
      return new Response('No handler for this request');
  }
}
