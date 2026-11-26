// AI_MODELS configuration (NFR-PORT, AI_SYSTEM §2). Model IDs live here and in the AI_MODELS
// Worker var — never in feature code (enforced by tests/verify_repo.py).
// The defaults are the initial choices from AI_SYSTEM §2; SPIKE P0-AI-1 confirms or replaces them.

import { PROVIDERS, isProviderId, type ProviderId } from './providers.ts';
import { assertRoutable, type ContentPart, type Privacy } from './privacy.ts';

export type AiTask =
  | 'chat'
  | 'gen_cards'
  | 'gen_questions'
  | 'validate'
  | 'grade'
  | 'ocr'
  | 'primer'
  | 'embed'
  | 'rerank'
  | 'catalog_extract'
  | 'catalog_topics';

export const AI_TASKS: readonly AiTask[] = [
  'chat', 'gen_cards', 'gen_questions', 'validate', 'grade', 'ocr', 'primer', 'embed', 'rerank', 'catalog_extract', 'catalog_topics',
];

export type ModelRef = { provider: ProviderId; model: string };

/** Per task: the route for published content, and (if the task can ever see personal content) for personal content. */
export type TaskRoutes = { published: ModelRef; personal: ModelRef | null };
export type AiModelsConfig = Record<AiTask, TaskRoutes>;

const WAI_MISTRAL = '@cf/mistralai/mistral-small-3.1-24b-instruct';
const WAI_SCOUT = '@cf/meta/llama-4-scout-17b-16e-instruct';
const WAI_EMBED = '@cf/baai/bge-base-en-v1.5';
const WAI_RERANK = '@cf/baai/bge-reranker-base';
const GEMINI_FLASH = 'gemini-3.8-flash';
const GEMINI_LITE = 'gemini-3.5-flash-lite';

const wai = (model: string): ModelRef => ({ provider: 'workers_ai', model });
const gem = (model: string): ModelRef => ({ provider: 'gemini', model });

export const DEFAULT_AI_MODELS: AiModelsConfig = {
  chat: { published: gem(GEMINI_FLASH), personal: wai(WAI_MISTRAL) },
  gen_cards: { published: gem(GEMINI_FLASH), personal: wai(WAI_MISTRAL) },
  gen_questions: { published: gem(GEMINI_FLASH), personal: wai(WAI_MISTRAL) },
  // The validator uses a different model from the generator, to reduce correlated errors (AI_SYSTEM §6.3).
  validate: { published: gem(GEMINI_LITE), personal: wai(WAI_SCOUT) },
  grade: { published: gem(GEMINI_FLASH), personal: wai(WAI_MISTRAL) },
  ocr: { published: gem(GEMINI_FLASH), personal: wai(WAI_MISTRAL) },
  // Primers and catalog pages are built from topic names and public web pages only: never personal.
  primer: { published: gem(GEMINI_FLASH), personal: null },
  embed: { published: wai(WAI_EMBED), personal: wai(WAI_EMBED) },
  rerank: { published: wai(WAI_RERANK), personal: wai(WAI_RERANK) },
  catalog_extract: { published: gem(GEMINI_LITE), personal: null },
  catalog_topics: { published: gem(GEMINI_LITE), personal: null },
};

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}

function parseRef(value: unknown, where: string): ModelRef {
  if (typeof value !== 'object' || value === null) throw new AiConfigError(`${where}: expected {provider, model}`);
  const rec = value as Record<string, unknown>;
  if (!isProviderId(rec['provider'])) throw new AiConfigError(`${where}: unknown provider ${JSON.stringify(rec['provider'])}`);
  const model = rec['model'];
  if (typeof model !== 'string' || model.trim() === '') throw new AiConfigError(`${where}: model must be a non-empty string`);
  return { provider: rec['provider'], model: model.trim() };
}

/**
 * Parse the AI_MODELS var (JSON). Missing tasks fall back to the defaults.
 * Rejects any personal route that points at a provider which trains on free-tier data, so a bad
 * config fails at startup instead of at request time.
 */
export function parseAiModels(raw: string | undefined): AiModelsConfig {
  const config: AiModelsConfig = { ...DEFAULT_AI_MODELS };
  if (raw !== undefined && raw.trim() !== '') {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      throw new AiConfigError('AI_MODELS is not valid JSON');
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new AiConfigError('AI_MODELS must be a JSON object');
    for (const [task, value] of Object.entries(data as Record<string, unknown>)) {
      if (!(AI_TASKS as readonly string[]).includes(task)) throw new AiConfigError(`AI_MODELS: unknown task "${task}"`);
      if (typeof value !== 'object' || value === null) throw new AiConfigError(`AI_MODELS.${task}: expected an object`);
      const rec = value as Record<string, unknown>;
      const published = parseRef(rec['published'], `AI_MODELS.${task}.published`);
      const personal = rec['personal'] === null || rec['personal'] === undefined ? null : parseRef(rec['personal'], `AI_MODELS.${task}.personal`);
      config[task as AiTask] = { published, personal };
    }
  }
  for (const task of AI_TASKS) {
    const personal = config[task].personal;
    if (personal && PROVIDERS[personal.provider].trainsOnFreeTier) {
      throw new AiConfigError(`AI_MODELS.${task}.personal uses "${personal.provider}", which trains on free-tier data (PRV-02)`);
    }
  }
  return config;
}

export class NoPrivateRoute extends Error {
  constructor(task: AiTask) {
    super(`Task "${task}" has no route for personal content.`);
    this.name = 'NoPrivateRoute';
  }
}

/** Pick the model for a task and its content, and enforce the privacy guard on the way out. */
export function routeFor(config: AiModelsConfig, task: AiTask, privacy: Privacy, parts: readonly ContentPart[]): ModelRef {
  const routes = config[task];
  const ref = privacy === 'personal' ? routes.personal : routes.published;
  if (!ref) throw new NoPrivateRoute(task);
  assertRoutable(ref.provider, parts);
  return ref;
}
