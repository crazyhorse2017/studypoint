// The Worker application, with its dependencies injected so it can be tested without network
// access or bindings. The real entry point (index.ts) wires in the jose verifier and D1.

import { authenticate, type TokenVerifier } from './auth/middleware.ts';
import { readAuthConfig, type AuthConfig, type AuthEnv, type Identity } from './auth/policy.ts';
import { ExportFormatError, gunzipJson, parseExportDocument } from './backup/format.ts';
import { RestoreRefused, exportUser, restoreUser } from './backup/d1.ts';
import { apiError, json } from './http.ts';
import { getAppearance, patchAppearance } from './settings.ts';

/** Small JSON bodies only (settings and similar). Imports have their own path. */
const MAX_JSON_BYTES = 64 * 1024;

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_JSON_BYTES) throw new SyntaxError('Body too large');
  return JSON.parse(text);
}

export const APP_VERSION = '0.1.0';

export type Env = AuthEnv & {
  ASSETS: Fetcher;
  /** D1, R2 and the rest are bound in T0.05; routes that need them answer 503 until then. */
  DB?: D1Database;
  FILES?: R2Bucket;
  VEC?: VectorizeIndex;
};

export type RequestContext = {
  request: Request;
  env: Env;
  identity: Identity;
  /** The signed-in user's row id, or null while D1 isn't bound yet. */
  userId: string | null;
  url: URL;
};

export type Route = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: (ctx: RequestContext) => Promise<Response> | Response;
};

const needsDb = () => apiError(503, 'storage_unavailable', "Studypoint's database isn't connected yet.");

/** Every API route. All of them sit behind `authenticate` (route-table test in workerApp.test.ts). */
export const ROUTES: readonly Route[] = [
  {
    method: 'GET',
    path: '/api/health',
    handler: () => json({ status: 'ok', service: 'studypoint', version: APP_VERSION }),
  },
  {
    method: 'GET',
    path: '/api/me',
    handler: ({ identity }) => json({ email: identity.email, via: identity.via }),
  },
  {
    // UX-01/03: appearance and reading settings.
    method: 'GET',
    path: '/api/settings',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      return json(await getAppearance(env.DB, userId));
    },
  },
  {
    method: 'PATCH',
    path: '/api/settings',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return apiError(400, 'invalid_json', "The settings update couldn't be read.");
      }
      return json(await patchAppearance(env.DB, userId, body));
    },
  },
  {
    // EXP-01: full JSON export of everything.
    method: 'GET',
    path: '/api/export',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      const doc = await exportUser(env.DB, userId, APP_VERSION);
      const day = doc.exported_at.slice(0, 10);
      return json(doc, 200, { 'Content-Disposition': `attachment; filename="studypoint-export-${day}.json"` });
    },
  },
  {
    // EXP-01: restore an export into an empty account. Accepts plain or gzipped JSON.
    method: 'POST',
    path: '/api/import',
    handler: async ({ request, env, userId, identity }) => {
      if (!env.DB || !userId) return needsDb();
      let raw: unknown;
      try {
        const bytes = new Uint8Array(await request.arrayBuffer());
        raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzipJson(bytes) : JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        return apiError(400, 'unreadable_file', "That file couldn't be read. Choose a Studypoint export (.json or .json.gz).");
      }
      try {
        const doc = parseExportDocument(raw);
        const statements = await restoreUser(env.DB, doc, userId, identity.email);
        return json({ restored: true, statements });
      } catch (err) {
        if (err instanceof ExportFormatError) return apiError(400, 'invalid_export', err.message);
        if (err instanceof RestoreRefused) return apiError(409, 'not_empty', err.message);
        throw err;
      }
    },
  },
];

export type AppDeps = {
  /** Builds the JWT verifier for the configured issuer + audience. */
  makeVerifier: (config: AuthConfig) => TokenVerifier;
  /** Called once a request is authenticated; returns the user's row id (creating it on first sign-in). */
  resolveUserId?: (env: Env, identity: Identity) => Promise<string | null>;
};

const NO_VERIFIER: TokenVerifier = async () => {
  throw new Error('No verifier configured');
};

export function createApp(deps: AppDeps) {
  async function handleApi(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const config = readAuthConfig(env);
    const verifier = config.issuer && config.aud ? deps.makeVerifier(config) : NO_VERIFIER;

    const auth = await authenticate(request, config, verifier);
    if (!auth.ok) return apiError(auth.status, auth.code, auth.message);

    const matching = ROUTES.filter((r) => r.path === url.pathname);
    if (matching.length === 0) return apiError(404, 'not_found', "That API route doesn't exist.");
    const route = matching.find((r) => r.method === request.method);
    if (!route) {
      return apiError(405, 'method_not_allowed', `Use ${matching.map((r) => r.method).join(' or ')} for this endpoint.`);
    }

    const userId = deps.resolveUserId ? await deps.resolveUserId(env, auth.identity) : null;
    try {
      return await route.handler({ request, env, identity: auth.identity, userId, url });
    } catch {
      // Never leak internals (stack traces, SQL) to the client; details go to Workers logs.
      return apiError(500, 'internal_error', 'Something went wrong. Try again.');
    }
  }

  return {
    handleApi,
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api/')) return handleApi(request, env);
      return env.ASSETS.fetch(request);
    },
  };
}
