// AI request handlers (step 5, ARCHITECTURE A24). Each takes the decrypted text the browser sends for ONE
// request, runs it through the gateway, and returns the result; nothing sent is stored (only usage counts
// and a generations row with sizes, model and prompt version, never content).

import { extractJson, parseArticle, parseCards, parseDiagram, parseGrade, parsePlan, parseQuiz, parseTopics, parseVerdicts } from '../../shared/aiOutput.ts';
import { uuid7 } from '../../shared/uuid7.ts';
import { AiError, complete, completeStream, embed, modelFor, ocr, type AiEnv } from './gateway.ts';
import { PROMPT_VERSIONS, answerPrompt, articlePrompt, cardsPrompt, diagramPrompt, gradePrompt, planPrompt, quizPrompt, topicsPrompt, validatePrompt, type Passage } from './prompts.ts';

const MAX_PASSAGES = 40;
const MAX_PASSAGE_CHARS = 6000;
const MAX_TOTAL_CHARS = 140_000;

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

export function readPassages(raw: unknown): Passage[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new AiError(400, 'Choose some material first.');
  if (raw.length > MAX_PASSAGES) throw new AiError(400, `At most ${MAX_PASSAGES} passages per request.`);
  let total = 0;
  const out = raw.map((p, i) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const text = s(o['text'], MAX_PASSAGE_CHARS);
    total += text.length;
    return { ref: s(o['ref'], 8) || `P${i + 1}`, label: s(o['label'], 200), text, ocr: o['ocr'] === true, url: typeof o['url'] === 'string' ? s(o['url'], 500) : undefined };
  });
  if (total > MAX_TOTAL_CHARS) throw new AiError(413, 'That’s too much material for one request. Pick fewer pages.');
  return out;
}

async function logGeneration(env: AiEnv, userId: string, task: string, promptVersion: string, model: string, produced: number, inChars: number, outChars: number, started: number): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(`INSERT INTO generations (id, user_id, task, provider, model, prompt_version, effective_privacy, produced, input_tokens, output_tokens, latency_ms, created_at)
    VALUES (?, ?, ?, 'workers-ai', ?, ?, 'personal', ?, ?, ?, ?, ?)`).bind(uuid7(), userId, task, model, promptVersion, produced, Math.ceil(inChars / 4), Math.ceil(outChars / 4), Date.now() - started, Date.now()).run().catch(() => undefined);
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);

export async function handleEmbed(env: AiEnv, userId: string, b: Record<string, unknown>) {
  const texts = Array.isArray(b['texts']) ? b['texts'].map((t) => s(t, 8000)) : [];
  return { vectors: await embed(env, userId, texts) };
}

export async function handleOcr(env: AiEnv, userId: string, b: Record<string, unknown>) {
  const image = s(b['image'], 8_000_000);
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) throw new AiError(400, 'Send a PNG, JPEG or WebP image.');
  return { text: await ocr(env, userId, image) };
}

export async function handleAnswer(env: AiEnv, userId: string, b: Record<string, unknown>) {
  const question = s(b['question'], 2000).trim();
  if (question.length < 3) throw new AiError(400, 'Type a question.');
  const passages = readPassages(b['passages']);
  const started = Date.now();
  const messages = answerPrompt(question, passages, b['mode'] === 'tutor' ? 'tutor' : 'direct', b['general'] !== false);
  const text = await complete(env, userId, 'answer', messages, { maxTokens: 1800 });
  await logGeneration(env, userId, 'chat', PROMPT_VERSIONS.answer, modelFor(env, 'answer'), 1, question.length, text.length, started);
  return { text, promptVersion: PROMPT_VERSIONS.answer };
}

const STREAM_HEADERS: Record<string, string> = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/**
 * The answer, streamed as newline-delimited JSON (step 6a, AST-01; format in shared/sseText.ts). Input
 * problems and a failure to start throw an AiError (a normal JSON error); once streaming, a failure is
 * sent as an `{"error"}` line. Citations are verified in the browser, sentence by sentence.
 */
export async function handleAnswerStream(env: AiEnv, userId: string, b: Record<string, unknown>): Promise<Response> {
  const question = s(b['question'], 2000).trim();
  if (question.length < 3) throw new AiError(400, 'Type a question.');
  const passages = readPassages(b['passages']);
  const started = Date.now();
  const messages = answerPrompt(question, passages, b['mode'] === 'tutor' ? 'tutor' : 'direct', b['general'] !== false);
  const deltas = await completeStream(env, userId, 'answer', messages, { maxTokens: 1800 });
  const enc = new TextEncoder();
  const line = (o: unknown) => enc.encode(`${JSON.stringify(o)}\n`);
  let outChars = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await deltas.next();
        if (!next.done) {
          outChars += next.value.length;
          controller.enqueue(line({ t: next.value }));
          return;
        }
        if (outChars === 0) controller.enqueue(line({ error: 'The AI ran out of room before answering. Try a smaller selection.' }));
        else {
          controller.enqueue(line({ done: true, promptVersion: PROMPT_VERSIONS.answer }));
          await logGeneration(env, userId, 'chat', PROMPT_VERSIONS.answer, modelFor(env, 'answer'), 1, question.length, outChars, started);
        }
        controller.close();
      } catch (err) {
        controller.enqueue(line({ error: err instanceof AiError ? err.message : 'The AI couldn’t finish. Try again in a moment.' }));
        controller.close();
      }
    },
    async cancel() {
      await deltas.return(undefined);
    },
  });
  return new Response(body, { status: 200, headers: STREAM_HEADERS });
}

type GenKind = 'cards' | 'quiz' | 'article' | 'diagram' | 'plan' | 'topics';

export async function handleGenerate(env: AiEnv, userId: string, b: Record<string, unknown>) {
  const kind = b['kind'] as GenKind;
  const topic = s(b['topic'], 300);
  const started = Date.now();
  let messages;
  let version: string;
  let maxTokens = 3500;
  // Step 6b: everything but study guides thinks at low effort (2–3× faster; the checker still reviews items).
  let effort: 'low' | 'medium' = 'low';
  if (kind === 'plan') {
    const outline = s(b['outline'], 60_000);
    if (outline.length < 20) throw new AiError(400, 'Process some files in this course first.');
    messages = planPrompt(outline, s(b['courseName'], 200));
    version = PROMPT_VERSIONS.plan;
    maxTokens = 2000;
  } else if (kind === 'topics') {
    // A course's main topics from trusted web pages (the automatic practice test, step 6b).
    messages = topicsPrompt(readPassages(b['passages']), s(b['courseName'], 200), clampInt(b['count'], 3, 12, 8));
    version = PROMPT_VERSIONS.topics;
    maxTokens = 1200;
  } else {
    const passages = readPassages(b['passages']);
    if (kind === 'cards') {
      const types = (Array.isArray(b['types']) ? b['types'] : ['basic', 'cloze', 'typed']).filter((t): t is string => t === 'basic' || t === 'cloze' || t === 'typed');
      messages = cardsPrompt(passages, topic, clampInt(b['count'], 1, 30, 12), types.length ? types : ['basic']);
      version = PROMPT_VERSIONS.cards;
    } else if (kind === 'quiz') {
      const formats = (Array.isArray(b['formats']) ? b['formats'] : ['mcq', 'tf', 'numeric', 'short']).filter((t): t is string => ['mcq', 'tf', 'numeric', 'short'].includes(String(t)));
      messages = quizPrompt(passages, topic, clampInt(b['count'], 1, 20, 8), formats.length ? formats : ['mcq'], clampInt(b['difficulty'], 1, 5, 3));
      version = PROMPT_VERSIONS.quiz;
      maxTokens = 4500;
    } else if (kind === 'article') {
      messages = articlePrompt(passages, topic || 'the main ideas', b['length'] === 'medium' ? 'medium' : 'short');
      version = PROMPT_VERSIONS.article;
      maxTokens = 4500;
      effort = 'medium';
    } else if (kind === 'diagram') {
      messages = diagramPrompt(passages, topic || 'the main ideas');
      version = PROMPT_VERSIONS.diagram;
      maxTokens = 1500;
    } else throw new AiError(400, 'Unknown kind of material.');
  }
  const text = await complete(env, userId, 'generate', messages, { maxTokens, json: true, effort });
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    throw new AiError(502, 'The AI’s reply couldn’t be read. Try again.');
  }
  const result =
    kind === 'cards' ? { items: parseCards(raw) }
      : kind === 'quiz' ? { items: parseQuiz(raw) }
        : kind === 'article' ? { article: parseArticle(raw) }
          : kind === 'diagram' ? { diagram: parseDiagram(raw) }
            : kind === 'topics' ? { topics: parseTopics(raw) }
              : { topics: parsePlan(raw) };
  const r = result as { items?: unknown[]; topics?: unknown[] };
  const produced = r.items?.length ?? r.topics?.length ?? 1;
  await logGeneration(env, userId, kind === 'cards' ? 'gen_cards' : kind === 'quiz' ? 'gen_questions' : kind === 'plan' || kind === 'topics' ? 'plan' : 'primer', version, modelFor(env, 'generate'), produced, messages.reduce((n, m) => n + m.content.length, 0), text.length, started);
  return { kind, promptVersion: version, ...result };
}

export async function handleValidate(env: AiEnv, userId: string, b: Record<string, unknown>) {
  const kind = b['kind'] === 'quiz' ? 'quiz' : 'cards';
  const items = Array.isArray(b['items']) ? b['items'].slice(0, 40) : [];
  if (items.length === 0) return { verdicts: [] };
  const passages = readPassages(b['passages']);
  const text = await complete(env, userId, 'validate', validatePrompt(kind, items, passages), { maxTokens: 1500, json: true });
  try {
    return { verdicts: parseVerdicts(extractJson(text)), promptVersion: kind === 'quiz' ? PROMPT_VERSIONS.validate_quiz : PROMPT_VERSIONS.validate_cards };
  } catch {
    throw new AiError(502, 'The checker’s reply couldn’t be read. Try again.');
  }
}

export async function handleGrade(env: AiEnv, userId: string, b: Record<string, unknown>) {
  const rubric = Array.isArray(b['rubric']) ? b['rubric'].map((r) => s(r, 300)).slice(0, 8) : [];
  const text = await complete(env, userId, 'grade', gradePrompt(s(b['stem'], 3000), s(b['answer'], 3000), rubric, s(b['response'], 4000)), { maxTokens: 500, json: true });
  try {
    return { ...parseGrade(extractJson(text)), promptVersion: PROMPT_VERSIONS.grade };
  } catch {
    throw new AiError(502, 'The grader’s reply couldn’t be read. Try again.');
  }
}
