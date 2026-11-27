// The ONE place the Worker calls an AI model (AGENTS 1/3, ARCHITECTURE A7, A24). Everything Alex adds is
// personal and encrypted, so every task runs on Workers AI (Cloudflare's own models), never on a
// provider that trains on free-tier data (PRV-02). The browser sends the decrypted text a request needs;
// nothing sent here is stored. Model IDs come from the AI_MODELS var, never from code.

export type AiTask = 'answer' | 'generate' | 'validate' | 'grade' | 'embed' | 'ocr';

export type AiEnv = { AI?: Ai; AI_MODELS?: string; DB?: D1Database };

export class AiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

export function modelFor(env: AiEnv, task: AiTask): string {
  let map: Record<string, unknown> = {};
  try {
    map = JSON.parse(env.AI_MODELS ?? '{}') as Record<string, unknown>;
  } catch {
    map = {};
  }
  const m = map[task];
  if (typeof m !== 'string' || !m) throw new AiError(503, `No AI model is set for “${task}”. Add it to AI_MODELS.`);
  return m;
}

function ai(env: AiEnv): Ai {
  if (!env.AI) throw new AiError(503, 'AI isn’t connected to this Studyflare yet.');
  return env.AI;
}

/** Text out of whichever response shape a Workers AI text model returns (classic, chat completions, responses). */
export function textOf(res: unknown): string {
  if (typeof res === 'string') return res;
  const r = (res ?? {}) as Record<string, unknown>;
  if (typeof r['response'] === 'string') return r['response'];
  if (r['response'] && typeof r['response'] === 'object') return JSON.stringify(r['response']);
  const choices = r['choices'] as Array<{ message?: { content?: unknown } }> | undefined;
  const c = choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (typeof r['output_text'] === 'string') return r['output_text'];
  const output = r['output'] as Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }> | undefined;
  if (Array.isArray(output)) {
    const parts = output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []).filter((p) => typeof p.text === 'string').map((p) => p.text as string);
    if (parts.length) return parts.join('');
  }
  return '';
}

async function recordUsage(env: AiEnv, userId: string, task: AiTask, inChars: number, outChars: number): Promise<void> {
  if (!env.DB) return;
  const day = new Date().toISOString().slice(0, 10);
  // Character counts / 4 ≈ tokens. Content is never recorded, only sizes.
  await env.DB.prepare(`INSERT INTO ai_usage (user_id, day, provider, task, requests, input_tokens, output_tokens, neurons) VALUES (?1, ?2, 'workers-ai', ?3, 1, ?4, ?5, 0)
    ON CONFLICT(user_id, day, provider, task) DO UPDATE SET requests = requests + 1, input_tokens = input_tokens + ?4, output_tokens = output_tokens + ?5`)
    .bind(userId, day, task, Math.ceil(inChars / 4), Math.ceil(outChars / 4)).run().catch(() => undefined);
}

function friendly(err: unknown): AiError {
  const msg = err instanceof Error ? err.message : String(err);
  if (/4006|daily free allocation|neurons/i.test(msg)) return new AiError(429, 'Today’s free AI allowance is used up. It resets at midnight UTC (or switch to Workers Paid).');
  if (/timeout|timed out/i.test(msg)) return new AiError(504, 'The AI took too long. Try a smaller selection.');
  return new AiError(502, 'The AI couldn’t answer just now. Try again in a moment.');
}

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

/** One text completion. `json` asks for a JSON object (parsed and validated by the caller). */
export async function complete(env: AiEnv, userId: string, task: Exclude<AiTask, 'embed' | 'ocr'>, messages: ChatMessage[], opts: { maxTokens?: number; json?: boolean } = {}): Promise<string> {
  const model = modelFor(env, task);
  let res: unknown;
  try {
    res = await ai(env).run(model as keyof AiModels, {
      messages,
      max_tokens: opts.maxTokens ?? 2048,
      temperature: task === 'generate' ? 0.4 : 0.2,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
    } as never);
  } catch (err) {
    throw friendly(err);
  }
  const text = textOf(res).trim();
  await recordUsage(env, userId, task, messages.reduce((n, m) => n + m.content.length, 0), text.length);
  if (!text) throw new AiError(502, 'The AI returned an empty answer. Try again.');
  return text;
}

/** Embeddings for search (normalised later in the browser). Max 32 texts per call. */
export async function embed(env: AiEnv, userId: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.length > 32) throw new AiError(400, 'Too many texts at once.');
  let res: unknown;
  try {
    res = await ai(env).run(modelFor(env, 'embed') as keyof AiModels, { text: texts } as never);
  } catch (err) {
    throw friendly(err);
  }
  const r = (res ?? {}) as Record<string, unknown>;
  const data = (r['data'] ?? r['response']) as unknown;
  if (!Array.isArray(data) || data.length !== texts.length || !data.every((v) => Array.isArray(v))) throw new AiError(502, 'The search model returned something unexpected.');
  await recordUsage(env, userId, 'embed', texts.reduce((n, t) => n + t.length, 0), 0);
  return data as number[][];
}

const OCR_PROMPT = 'Transcribe ALL text in this image exactly as written, top to bottom, including handwriting, equations (as LaTeX with backslash commands, no $ signs), labels and table cells. Keep line breaks. If a word is illegible write [illegible]. Output only the transcription, nothing else.';

/** Read the text in a photo or scanned page (LIB-04). `dataUrl` is a JPEG/PNG/WebP data URL. */
export async function ocr(env: AiEnv, userId: string, dataUrl: string): Promise<string> {
  let res: unknown;
  try {
    res = await ai(env).run(modelFor(env, 'ocr') as keyof AiModels, {
      messages: [{ role: 'user', content: [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url: dataUrl } }] }],
      max_tokens: 3000,
      temperature: 0,
    } as never);
  } catch (err) {
    throw friendly(err);
  }
  const text = textOf(res).trim();
  await recordUsage(env, userId, 'ocr', dataUrl.length / 8, text.length);
  return text;
}
