// Studypoint Worker entry (ARCHITECTURE §3.2).
// The SPA is served from static assets; only /api/* reaches this code (`run_worker_first`).
// Auth middleware (AUTH-01..05) is added in T0.12. Until then Cloudflare Access on the
// workers.dev route (T0.07) is the only gate, and no route here returns user data.

import { apiError, json } from './http.ts';

export type Env = {
  ASSETS: Fetcher;
};

export const APP_VERSION = '0.1.0';

export async function handleApi(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/api/health') {
    if (request.method !== 'GET') return apiError(405, 'method_not_allowed', 'Use GET for this endpoint.');
    return json({ status: 'ok', service: 'studypoint', version: APP_VERSION });
  }

  return apiError(404, 'not_found', "That API route doesn't exist.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
