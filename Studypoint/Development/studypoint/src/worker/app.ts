// The Worker application, with its dependencies injected so it can be tested without network
// access or bindings. The real entry point (index.ts) wires in the jose verifier and D1.

import { authenticate, type TokenVerifier } from './auth/middleware.ts';
import { readAuthConfig, type AuthConfig, type AuthEnv, type Identity } from './auth/policy.ts';
import { ExportFormatError, gunzipJson, parseExportDocument } from './backup/format.ts';
import { RestoreRefused, exportUser, restoreUser } from './backup/d1.ts';
import { apiError, json } from './http.ts';
import { getAppearance, patchAppearance } from './settings.ts';
import { DuplicateCourse, createCourse, deleteCourse, getHomeSchool, listCourses, setHomeSchool, updateCourse } from './courses.ts';
import { validateCourse, validateSchool } from '../shared/courses.ts';
import { matchPath, type RouteParams } from '../shared/routeMatch.ts';
import { isOwner } from './owners.ts';
import { parseAllowedEmails } from './auth/policy.ts';
import { effectiveEnv, needsSetup, readStoredConfig, writeStoredConfig, type StoredConfig } from './setup/config.ts';
import { SetupError, runSetup } from './setup/cloudflare.ts';
import { MAX_NOTE_BODY_CHARS, NoteError, createNote, deleteNote, getNote, listNotes, restoreNote, updateNote } from './notes.ts';
import { VaultError, addPasskey, createVaultRow, getVault, markPasskeyUsed, removePasskey, updateVaultRow } from './vault.ts';

/** Runs a vault operation, turning VaultError into its HTTP answer. */
async function vaultCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof VaultError) return apiError(err.status, 'vault_error', err.message);
    throw err;
  }
}

/** The one-time Cloudflare token sent to first-run setup (never stored). */
function tokenFrom(body: unknown): string | undefined {
  const t = (body as Record<string, unknown> | null)?.['token'];
  return typeof t === 'string' && t.trim() !== '' ? t.trim() : undefined;
}

/** Small JSON bodies only (settings and similar). Imports have their own path. */
const MAX_JSON_BYTES = 64 * 1024;

async function readJson(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new SyntaxError('Body too large');
  return JSON.parse(text);
}

/** Note bodies are larger than settings-sized JSON: the body limit plus room for the other fields. */
const MAX_NOTE_JSON = MAX_NOTE_BODY_CHARS + 16 * 1024;

async function noteCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NoteError) return apiError(err.status, 'note_error', err.message);
    throw err;
  }
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
  /** Values of :params in the route path, e.g. { id } for /api/courses/:id. */
  params: RouteParams;
};

export type Route = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler: (ctx: RequestContext) => Promise<Response> | Response;
};

const needsDb = () => apiError(503, 'storage_unavailable', "Studyflare's database isn't connected yet.");

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
    handler: ({ identity, env }) => json({ email: identity.email, via: identity.via, owner: identity.via === 'access' && isOwner(env, identity.email) }),
  },
  {
    // AUTH-08: the encryption vault (wrapped keys only; the Worker can't unlock anything).
    method: 'GET',
    path: '/api/vault',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      return json(await getVault(env.DB, userId));
    },
  },
  {
    method: 'PUT',
    path: '/api/vault',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return apiError(400, 'invalid_json', "That request couldn't be read.");
      }
      const db = env.DB;
      return vaultCall(async () => {
        await createVaultRow(db, userId, body);
        return json(await getVault(db, userId), 201);
      });
    },
  },
  {
    method: 'PATCH',
    path: '/api/vault',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return apiError(400, 'invalid_json', "That request couldn't be read.");
      }
      const db = env.DB;
      return vaultCall(async () => {
        await updateVaultRow(db, userId, body);
        return json(await getVault(db, userId));
      });
    },
  },
  {
    method: 'POST',
    path: '/api/vault/passkeys',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return apiError(400, 'invalid_json', "That request couldn't be read.");
      }
      const db = env.DB;
      return vaultCall(async () => {
        await addPasskey(db, userId, body);
        return json(await getVault(db, userId), 201);
      });
    },
  },
  {
    method: 'POST',
    path: '/api/vault/passkeys/:id/used',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      await markPasskeyUsed(env.DB, userId, params['id'] ?? '');
      return json({ ok: true });
    },
  },
  {
    method: 'DELETE',
    path: '/api/vault/passkeys/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await removePasskey(env.DB, userId, params['id'] ?? ''))
        ? json(await getVault(env.DB, userId))
        : apiError(404, 'not_found', "That passkey isn't on this account.");
    },
  },
  {
    // LIB-08 + AUTH-08: typed notes. Title and body are ciphertext; the Worker refuses plaintext.
    method: 'GET',
    path: '/api/notes',
    handler: async ({ env, userId, url }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ notes: await listNotes(env.DB, userId, url.searchParams.get('course')) });
    },
  },
  {
    method: 'POST',
    path: '/api/notes',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request, MAX_NOTE_JSON);
      } catch {
        return apiError(413, 'invalid_json', "That note couldn't be read. It may be too long.");
      }
      const db = env.DB;
      return noteCall(async () => json({ note: await createNote(db, userId, body) }, 201));
    },
  },
  {
    method: 'GET',
    path: '/api/notes/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const note = await getNote(env.DB, userId, params['id'] ?? '');
      return note ? json({ note }) : apiError(404, 'not_found', "That note doesn't exist.");
    },
  },
  {
    method: 'PUT',
    path: '/api/notes/:id',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request, MAX_NOTE_JSON);
      } catch {
        return apiError(413, 'invalid_json', "That note couldn't be read. It may be too long.");
      }
      const db = env.DB;
      return noteCall(async () => json({ note: await updateNote(db, userId, params['id'] ?? '', body) }));
    },
  },
  {
    method: 'DELETE',
    path: '/api/notes/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await deleteNote(env.DB, userId, params['id'] ?? ''))
        ? json({ deleted: true })
        : apiError(404, 'not_found', "That note doesn't exist.");
    },
  },
  {
    method: 'POST',
    path: '/api/notes/:id/restore',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await restoreNote(env.DB, userId, params['id'] ?? ''))
        ? json({ restored: true })
        : apiError(404, 'not_found', "That note isn't in the trash.");
    },
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
    // INS-01: the home school (null until chosen).
    method: 'GET',
    path: '/api/school',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ school: await getHomeSchool(env.DB, userId) });
    },
  },
  {
    method: 'PUT',
    path: '/api/school',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return apiError(400, 'invalid_json', "That school couldn't be read.");
      }
      const v = validateSchool(body);
      if (!v.ok) return apiError(400, 'invalid_school', v.error);
      return json({ school: await setHomeSchool(env.DB, userId, v.value) });
    },
  },
  {
    // LIB-01 / INS-02: courses.
    method: 'GET',
    path: '/api/courses',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ courses: await listCourses(env.DB, userId) });
    },
  },
  {
    method: 'POST',
    path: '/api/courses',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return apiError(400, 'invalid_json', "That course couldn't be read.");
      }
      const v = validateCourse(body, await getHomeSchool(env.DB, userId));
      if (!v.ok) return apiError(400, 'invalid_course', v.error);
      try {
        return json({ course: await createCourse(env.DB, userId, v.value) }, 201);
      } catch (err) {
        if (err instanceof DuplicateCourse) return apiError(409, 'duplicate_course', err.message);
        throw err;
      }
    },
  },
  {
    method: 'PATCH',
    path: '/api/courses/:id',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      let body: Record<string, unknown>;
      try {
        body = (await readJson(request)) as Record<string, unknown>;
      } catch {
        return apiError(400, 'invalid_json', "That change couldn't be read.");
      }
      const name = typeof body?.['name'] === 'string' ? body['name'].trim().replace(/\s+/g, ' ') : undefined;
      if (name !== undefined && (name.length < 1 || name.length > 160)) return apiError(400, 'invalid_name', 'Course names need 1 to 160 characters.');
      const archived = typeof body?.['archived'] === 'boolean' ? body['archived'] : undefined;
      const course = await updateCourse(env.DB, userId, params['id'] ?? '', { name, archived });
      return course ? json({ course }) : apiError(404, 'not_found', "That course doesn't exist.");
    },
  },
  {
    method: 'DELETE',
    path: '/api/courses/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await deleteCourse(env.DB, userId, params['id'] ?? ''))
        ? json({ deleted: true })
        : apiError(404, 'not_found', "That course doesn't exist.");
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
        return apiError(400, 'unreadable_file', "That file couldn't be read. Choose a Studyflare export (.json or .json.gz).");
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
  /** Cloudflare API fetch for first-run setup (tests inject a fake). */
  fetchImpl?: typeof fetch;
};

const NO_VERIFIER: TokenVerifier = async () => {
  throw new Error('No verifier configured');
};

/** Wrangler values, with first-run setup values filled in where wrangler says "todo" (AUTH-07). */
async function resolveEnv(env: Env): Promise<Env> {
  if (!env.DB || !needsSetup(env)) return env;
  let stored: StoredConfig = {};
  try {
    stored = await readStoredConfig(env.DB);
  } catch {
    stored = {}; // table not migrated yet: behaves as "not set up"
  }
  return effectiveEnv(env, stored);
}

/**
 * First-run setup routes (AUTH-07). They are the only API that answers without sign-in, and only while
 * sign-in isn't configured; afterwards they report "done" and refuse to run again.
 */
async function handleSetup(request: Request, env: Env, url: URL, fetchImpl?: typeof fetch): Promise<Response> {
  const pending = needsSetup(env);
  const allowed = parseAllowedEmails(env.ALLOWED_EMAILS);
  if (request.method === 'GET') {
    return json({ needed: pending, emailsSet: allowed.emails.size > 0, host: url.hostname });
  }
  if (request.method !== 'POST') return apiError(405, 'method_not_allowed', 'Use GET or POST for this endpoint.');
  if (!pending) return apiError(409, 'already_set_up', 'Studyflare is already set up.');
  if (!env.DB) return needsDb();
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return apiError(400, 'invalid_json', "That request couldn't be read.");
  }
  const token = tokenFrom(body);
  if (!token) return apiError(400, 'missing_token', 'Paste your Cloudflare API token.');
  try {
    const outcome = await runSetup({ token, host: url.hostname, emails: [...allowed.emails].sort(), fetchImpl });
    await writeStoredConfig(env.DB, outcome.stored);
    return json({ done: true, branded: outcome.branded, orgCreated: outcome.orgCreated });
  } catch (err) {
    if (err instanceof SetupError) return apiError(err.status, 'setup_failed', err.message);
    return apiError(500, 'internal_error', 'Setup hit an unexpected problem. Try again.');
  }
}

export function createApp(deps: AppDeps) {
  async function handleApi(request: Request, rawEnv: Env): Promise<Response> {
    const url = new URL(request.url);
    const env = await resolveEnv(rawEnv);
    if (url.pathname === '/api/setup') return handleSetup(request, env, url, deps.fetchImpl);
    const config = readAuthConfig(env);
    if (needsSetup(env) && config.environment !== 'development') {
      return apiError(503, 'setup_required', 'Studyflare needs its one-time setup before anyone can sign in.');
    }
    const verifier = config.issuer && config.aud ? deps.makeVerifier(config) : NO_VERIFIER;

    const auth = await authenticate(request, config, verifier);
    if (!auth.ok) return apiError(auth.status, auth.code, auth.message);

    const matching = ROUTES.map((r) => ({ r, params: matchPath(r.path, url.pathname) })).filter((m) => m.params !== null);
    if (matching.length === 0) return apiError(404, 'not_found', "That API route doesn't exist.");
    const hit = matching.find((m) => m.r.method === request.method);
    if (!hit) {
      return apiError(405, 'method_not_allowed', `Use ${matching.map((m) => m.r.method).join(' or ')} for this endpoint.`);
    }

    const userId = deps.resolveUserId ? await deps.resolveUserId(env, auth.identity) : null;
    try {
      return await hit.r.handler({ request, env, identity: auth.identity, userId, url, params: hit.params ?? {} });
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
