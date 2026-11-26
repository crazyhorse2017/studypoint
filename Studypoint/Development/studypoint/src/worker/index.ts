// Studyflare Worker entry (ARCHITECTURE §3.2). Wires the real dependencies into the app:
// the jose Access-JWT verifier, D1 user resolution and the nightly backup cron.
// The SPA itself is served from static assets; only /api/* reaches this code (`run_worker_first`).

import { APP_VERSION, createApp, type Env } from './app.ts';
import { createAccessVerifier } from './auth/accessJwt.ts';
import { parseAllowedEmails } from './auth/policy.ts';
import { runNightlyBackup } from './backup/d1.ts';
import { ensureUser } from './users.ts';

const app = createApp({
  makeVerifier: (config) => createAccessVerifier(config.issuer ?? '', config.aud ?? ''),
  resolveUserId: async (env, identity) =>
    env.DB ? (await ensureUser(env.DB, identity, parseAllowedEmails(env.OWNER_EMAILS))).id : null,
});

export default {
  fetch: (request: Request, env: Env) => app.fetch(request, env),

  // EXP-02: nightly JSON backup of every account to R2 (cron in wrangler.jsonc). Skips quietly until D1 and R2 are bound.
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (!env.DB || !env.FILES) return;
    ctx.waitUntil(runNightlyBackup(env.DB, env.FILES, APP_VERSION).then(() => undefined));
  },
} satisfies ExportedHandler<Env>;
