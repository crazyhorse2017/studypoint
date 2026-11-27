// The Worker application, with its dependencies injected so it can be tested without network
// access or bindings. The real entry point (index.ts) wires in the jose verifier and D1.

import { authenticate, type TokenVerifier } from './auth/middleware.ts';
import { readAuthConfig, type AuthConfig, type AuthEnv, type Identity } from './auth/policy.ts';
import { ExportFormatError, gunzipJson, parseExportDocument } from './backup/format.ts';
import { RestoreRefused, exportUser, restoreUser } from './backup/d1.ts';
import { API_SECURITY_HEADERS, apiError, json } from './http.ts';
import { getAppearance, patchAppearance } from './settings.ts';
import { DuplicateCourse, createCourse, deleteCourse, getHomeSchool, listCourses, setHomeSchool, updateCourse } from './courses.ts';
import { validateCourse, validateSchool } from '../shared/courses.ts';
import { matchPath, type RouteParams } from '../shared/routeMatch.ts';
import { isOwner } from './owners.ts';
import { parseAllowedEmails } from './auth/policy.ts';
import { effectiveEnv, needsSetup, readStoredConfig, writeStoredConfig, type StoredConfig } from './setup/config.ts';
import { SetupError, runSetup } from './setup/cloudflare.ts';
import { CardError, MAX_CARD_CHARS, createCard, deleteCard, getStudySettings, listCards, restoreCard, reviewQueue, reviewSummary, setExam, setStudySettings, submitReview, updateCard, upcomingExams } from './cards.ts';
import { ImportError, importUrl } from './importUrl.ts';
import { AiError } from './ai/gateway.ts';
import { handleAnswer, handleAnswerStream, handleEmbed, handleGenerate, handleGrade, handleOcr, handleValidate } from './ai/handlers.ts';
import { LookupError, trustedSearch } from './ai/lookup.ts';
import { IndexError, MAX_INDEX_BYTES, getIndex, listIndexes, putIndex } from './aiIndex.ts';
import { QuizError, createQuiz, getQuiz, hideQuiz, listQuizzes, submitQuiz } from './quizzes.ts';
import { MAX_PLAN_CHARS, PlanError, cardReviewStats, deletePlan, getPlan, listPlans, savePlan } from './studyPlans.ts';
import { ConversationError, MAX_MESSAGE_CHARS, addMessages, createConversation, deleteConversation, getConversation, listConversations, renameConversation } from './conversations.ts';

async function planCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PlanError) return apiError(err.status, err.status === 409 ? 'conflict' : 'plan_error', err.message);
    throw err;
  }
}

async function conversationCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ConversationError) return apiError(err.status, 'conversation_error', err.message);
    throw err;
  }
}

/** Two messages (a question and an answer with its passages) per call, encrypted. */
const MAX_CONVERSATION_JSON = 2 * MAX_MESSAGE_CHARS + 16 * 1024;

async function quizCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof QuizError) return apiError(err.status, 'quiz_error', err.message);
    throw err;
  }
}
import { FileError, completeUpload, createUpload, deleteFile, getChunk, getFile, listFiles, putChunk, restoreFile } from './files.ts';
import { CHUNK_BYTES } from '../shared/fileSniff.ts';
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
const MAX_CARD_JSON = MAX_CARD_CHARS + 16 * 1024;
/** AI requests carry the decrypted passages for one request (up to ~140k characters) or one image. */
const MAX_AI_JSON = 9 * 1024 * 1024;

/** Runs an AI/lookup/index operation, turning their errors into plain HTTP answers. */
async function aiCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AiError || err instanceof LookupError || err instanceof IndexError) return apiError(err.status, 'ai_error', err.message);
    throw err;
  }
}

/** A POST route that reads JSON and passes it to an AI handler. */
function aiRoute(path: string, run: (env: Env, userId: string, body: Record<string, unknown>) => Promise<unknown>): Route {
  return {
    method: 'POST',
    path,
    handler: async ({ request, env, userId }) => {
      if (!userId) return needsDb();
      return withJson(request, (b) => aiCall(async () => json(await run(env, userId, (b ?? {}) as Record<string, unknown>))), MAX_AI_JSON);
    },
  };
}

const needsFiles = () => apiError(503, 'files_unavailable', "File storage isn't connected yet. Turn on R2 for this Studyflare to upload files.");

async function fileCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof FileError) {
      return json({ error: { code: err.status === 409 && err.existingId ? 'duplicate' : 'file_error', message: err.message, existingId: err.existingId } }, err.status);
    }
    throw err;
  }
}

async function cardCall(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof CardError) return apiError(err.status, 'card_error', err.message);
    throw err;
  }
}

/** Reads a JSON body or answers 400; `then` gets the parsed body. */
async function withJson(request: Request, then: (body: unknown) => Promise<Response>, max = MAX_JSON_BYTES): Promise<Response> {
  let body: unknown;
  try {
    body = await readJson(request, max);
  } catch {
    return apiError(400, 'invalid_json', "That request couldn't be read.");
  }
  return then(body);
}

const chunkIndex = (raw: string | undefined) => (raw !== undefined && /^\d{1,5}$/.test(raw) ? Number(raw) : -1);

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
  /** Workers AI (step 5) and which model does which task (JSON). */
  AI?: Ai;
  AI_MODELS?: string;
  /** Trusted web lookup (LKP-01); a Worker secret. */
  TAVILY_API_KEY?: string;
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
  // Step 5 (A24): AI. The browser sends the decrypted text one request needs; nothing is stored.
  aiRoute('/api/ai/embed', (env, u, b) => handleEmbed(env, u, b)),
  aiRoute('/api/ai/ocr', (env, u, b) => handleOcr(env, u, b)),
  aiRoute('/api/ai/answer', (env, u, b) => handleAnswer(env, u, b)),
  {
    // Step 6a (AST-01): the same answer, streamed as newline-delimited JSON.
    method: 'POST',
    path: '/api/ai/answer/stream',
    handler: async ({ request, env, userId }) => {
      if (!userId) return needsDb();
      return withJson(request, (b) => aiCall(() => handleAnswerStream(env, userId, (b ?? {}) as Record<string, unknown>)), MAX_AI_JSON);
    },
  },
  aiRoute('/api/ai/generate', (env, u, b) => handleGenerate(env, u, b)),
  aiRoute('/api/ai/validate', (env, u, b) => handleValidate(env, u, b)),
  aiRoute('/api/ai/grade', (env, u, b) => handleGrade(env, u, b)),
  aiRoute('/api/lookup', async (env, _u, b) => ({ results: await trustedSearch(env.TAVILY_API_KEY, b['query'], fetch, { raw: b['raw'] === true }), configured: Boolean(env.TAVILY_API_KEY) })),
  {
    method: 'GET',
    path: '/api/ai/status',
    handler: ({ env }) => json({ ai: Boolean(env.AI && env.AI_MODELS), lookup: Boolean(env.TAVILY_API_KEY), files: Boolean(env.FILES) }),
  },
  {
    // Step 6b (A26): study plans, one per course. The payload is ciphertext; the stage is in the clear.
    method: 'GET',
    path: '/api/plans',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ plans: await listPlans(env.DB, userId) });
    },
  },
  {
    method: 'GET',
    path: '/api/plans/:courseId',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ plan: await getPlan(env.DB, userId, params['courseId'] ?? '') });
    },
  },
  {
    method: 'PUT',
    path: '/api/plans/:courseId',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => planCall(async () => json({ plan: await savePlan(db, userId, params['courseId'] ?? '', b) })), MAX_PLAN_CHARS + 16 * 1024);
    },
  },
  {
    method: 'DELETE',
    path: '/api/plans/:courseId',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ deleted: await deletePlan(env.DB, userId, params['courseId'] ?? '') });
    },
  },
  {
    method: 'GET',
    path: '/api/plans/:courseId/review-stats',
    handler: async ({ env, userId, params, url }) => {
      if (!env.DB || !userId) return needsDb();
      const since = Number(url.searchParams.get('since'));
      return json({ stats: await cardReviewStats(env.DB, userId, params['courseId'] ?? '', Number.isFinite(since) && since > 0 ? since : Date.now() - 14 * 86_400_000) });
    },
  },
  {
    // Step 6a (AST-06): saved conversations. Titles and messages are ciphertext.
    method: 'GET',
    path: '/api/conversations',
    handler: async ({ env, userId, url }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ conversations: await listConversations(env.DB, userId, url.searchParams.get('course')) });
    },
  },
  {
    method: 'POST',
    path: '/api/conversations',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => conversationCall(async () => json({ conversation: await createConversation(db, userId, b) }, 201)));
    },
  },
  {
    method: 'GET',
    path: '/api/conversations/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const c = await getConversation(env.DB, userId, params['id'] ?? '');
      return c ? json({ conversation: c }) : apiError(404, 'not_found', "That conversation doesn't exist.");
    },
  },
  {
    method: 'POST',
    path: '/api/conversations/:id/messages',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => conversationCall(async () => json(await addMessages(db, userId, params['id'] ?? '', b))), MAX_CONVERSATION_JSON);
    },
  },
  {
    method: 'PATCH',
    path: '/api/conversations/:id',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => conversationCall(async () => ((await renameConversation(db, userId, params['id'] ?? '', b)) ? json({ renamed: true }) : apiError(404, 'not_found', "That conversation doesn't exist."))));
    },
  },
  {
    method: 'DELETE',
    path: '/api/conversations/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await deleteConversation(env.DB, userId, params['id'] ?? '')) ? json({ deleted: true }) : apiError(404, 'not_found', "That conversation doesn't exist.");
    },
  },
  {
    // QZ-01..04: practice quizzes (encrypted questions; scores in the clear).
    method: 'GET',
    path: '/api/quizzes',
    handler: async ({ env, userId, url }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ quizzes: await listQuizzes(env.DB, userId, url.searchParams.get('course') ?? '') });
    },
  },
  {
    method: 'POST',
    path: '/api/quizzes',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => quizCall(async () => json({ quiz: await createQuiz(db, userId, b) }, 201)), 4 * 1024 * 1024);
    },
  },
  {
    method: 'GET',
    path: '/api/quizzes/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const quiz = await getQuiz(env.DB, userId, params['id'] ?? '');
      return quiz ? json({ quiz }) : apiError(404, 'not_found', "That quiz doesn't exist.");
    },
  },
  {
    method: 'POST',
    path: '/api/quizzes/:id/submit',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => quizCall(async () => json(await submitQuiz(db, userId, params['id'] ?? '', b))), 4 * 1024 * 1024);
    },
  },
  {
    method: 'DELETE',
    path: '/api/quizzes/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await hideQuiz(env.DB, userId, params['id'] ?? '')) ? json({ deleted: true }) : apiError(404, 'not_found', "That quiz doesn't exist.");
    },
  },
  {
    // Encrypted search indexes (passages + vectors), one per source, built in the browser.
    method: 'GET',
    path: '/api/index',
    handler: async ({ env, userId, url }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ indexes: await listIndexes(env.DB, userId, url.searchParams.get('course')) });
    },
  },
  {
    method: 'PUT',
    path: '/api/index/:id',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      if (!env.FILES) return needsFiles();
      if (Number(request.headers.get('Content-Length') ?? '0') > MAX_INDEX_BYTES) return apiError(413, 'too_large', 'This index is too large.');
      const body = new Uint8Array(await request.arrayBuffer());
      const db = env.DB;
      const bucket = env.FILES;
      const meta = {
        fingerprint: request.headers.get('X-Index-Fingerprint') ?? '',
        passages: Number(request.headers.get('X-Index-Passages') ?? '-1'),
        embedModel: decodeURIComponent(request.headers.get('X-Index-Model') ?? ''),
      };
      return aiCall(async () => {
        await putIndex(db, bucket, userId, params['id'] ?? '', body, meta);
        return json({ ok: true });
      });
    },
  },
  {
    method: 'GET',
    path: '/api/index/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      if (!env.FILES) return needsFiles();
      const db = env.DB;
      const bucket = env.FILES;
      return aiCall(async () => {
        const obj = await getIndex(db, bucket, userId, params['id'] ?? '');
        return new Response(obj.body, { headers: { ...API_SECURITY_HEADERS, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, no-cache' } });
      });
    },
  },
  {
    // CRD-01..09: flashcards (encrypted payloads) and FSRS review.
    method: 'GET',
    path: '/api/cards',
    handler: async ({ env, userId, url }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ cards: await listCards(env.DB, userId, url.searchParams.get('course')) });
    },
  },
  {
    method: 'POST',
    path: '/api/cards',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => cardCall(async () => json({ card: await createCard(db, userId, b) }, 201)), MAX_CARD_JSON);
    },
  },
  {
    method: 'PUT',
    path: '/api/cards/:id',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => cardCall(async () => json({ card: await updateCard(db, userId, params['id'] ?? '', b) })), MAX_CARD_JSON);
    },
  },
  {
    method: 'DELETE',
    path: '/api/cards/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await deleteCard(env.DB, userId, params['id'] ?? '')) ? json({ deleted: true }) : apiError(404, 'not_found', "That card doesn't exist.");
    },
  },
  {
    method: 'POST',
    path: '/api/cards/:id/restore',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await restoreCard(env.DB, userId, params['id'] ?? '')) ? json({ restored: true }) : apiError(404, 'not_found', "That card isn't in the trash.");
    },
  },
  {
    method: 'GET',
    path: '/api/review/queue',
    handler: async ({ env, userId, url }) => {
      if (!env.DB || !userId) return needsDb();
      return json(await reviewQueue(env.DB, userId, url.searchParams.get('course')));
    },
  },
  {
    method: 'POST',
    path: '/api/review',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => cardCall(async () => json({ state: await submitReview(db, userId, b) })));
    },
  },
  {
    method: 'GET',
    path: '/api/review/summary',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      return json(await reviewSummary(env.DB, userId));
    },
  },
  {
    method: 'GET',
    path: '/api/study-settings',
    handler: async ({ env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ settings: await getStudySettings(env.DB, userId), exams: await upcomingExams(env.DB, userId) });
    },
  },
  {
    method: 'PATCH',
    path: '/api/study-settings',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => cardCall(async () => json({ settings: await setStudySettings(db, userId, b) })));
    },
  },
  {
    // CRD-07: a course's exam date (null clears it).
    method: 'PUT',
    path: '/api/courses/:id/exam',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const db = env.DB;
      return withJson(request, (b) => cardCall(async () => json({ exam: await setExam(db, userId, params['id'] ?? '', (b as Record<string, unknown> | null)?.['at'] ?? null) })));
    },
  },
  {
    // Import from a link: web pages become readable text, files come back as bytes. The browser then
    // encrypts and stores them like any upload; nothing fetched is kept on the server.
    method: 'POST',
    path: '/api/import-url',
    handler: async ({ request }) =>
      withJson(request, async (b) => {
        try {
          return await importUrl((b as Record<string, unknown> | null)?.['url']);
        } catch (err) {
          if (err instanceof ImportError) return apiError(err.status, 'import_error', err.message);
          throw err;
        }
      }),
  },
  {
    // LIB-02 + AUTH-08: uploaded files. Encrypted in the browser; the Worker stores ciphertext chunks in R2.
    method: 'GET',
    path: '/api/files',
    handler: async ({ env, userId, url }) => {
      if (!env.DB || !userId) return needsDb();
      return json({ files: await listFiles(env.DB, userId, url.searchParams.get('course')), storage: Boolean(env.FILES) });
    },
  },
  {
    method: 'POST',
    path: '/api/files',
    handler: async ({ request, env, userId }) => {
      if (!env.DB || !userId) return needsDb();
      if (!env.FILES) return needsFiles();
      let body: unknown;
      try {
        body = await readJson(request);
      } catch {
        return apiError(400, 'invalid_json', "That request couldn't be read.");
      }
      const db = env.DB;
      return fileCall(async () => json({ file: await createUpload(db, userId, body) }, 201));
    },
  },
  {
    method: 'GET',
    path: '/api/files/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      const file = await getFile(env.DB, userId, params['id'] ?? '');
      return file ? json({ file }) : apiError(404, 'not_found', "That file doesn't exist.");
    },
  },
  {
    method: 'PUT',
    path: '/api/files/:version/chunks/:n',
    handler: async ({ request, env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      if (!env.FILES) return needsFiles();
      const declared = Number(request.headers.get('Content-Length') ?? '0');
      if (declared > CHUNK_BYTES + 1024) return apiError(413, 'too_large', 'That part is too large.');
      const body = new Uint8Array(await request.arrayBuffer());
      if (body.length > CHUNK_BYTES + 1024) return apiError(413, 'too_large', 'That part is too large.');
      const db = env.DB;
      const bucket = env.FILES;
      return fileCall(async () => {
        await putChunk(db, bucket, userId, params['version'] ?? '', chunkIndex(params['n']), body);
        return json({ ok: true });
      });
    },
  },
  {
    method: 'GET',
    path: '/api/files/:version/chunks/:n',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      if (!env.FILES) return needsFiles();
      const db = env.DB;
      const bucket = env.FILES;
      return fileCall(async () => {
        const obj = await getChunk(db, bucket, userId, params['version'] ?? '', chunkIndex(params['n']));
        // Ciphertext, so it's safe to cache privately in this browser; never shared caches.
        return new Response(obj.body, {
          headers: { ...API_SECURITY_HEADERS, 'Content-Type': 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' },
        });
      });
    },
  },
  {
    method: 'POST',
    path: '/api/files/:version/complete',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      if (!env.FILES) return needsFiles();
      const db = env.DB;
      const bucket = env.FILES;
      return fileCall(async () => {
        await completeUpload(db, bucket, userId, params['version'] ?? '');
        return json({ ok: true });
      });
    },
  },
  {
    method: 'DELETE',
    path: '/api/files/:id',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await deleteFile(env.DB, userId, params['id'] ?? ''))
        ? json({ deleted: true })
        : apiError(404, 'not_found', "That file doesn't exist.");
    },
  },
  {
    method: 'POST',
    path: '/api/files/:id/restore',
    handler: async ({ env, userId, params }) => {
      if (!env.DB || !userId) return needsDb();
      return (await restoreFile(env.DB, userId, params['id'] ?? ''))
        ? json({ restored: true })
        : apiError(404, 'not_found', "That file isn't in the trash.");
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
