// PRV-02 privacy guard tests (TESTING §4.1). Includes a seeded randomised property test;
// CI adds a fast-check version alongside the Workers integration tests.

import {
  PrivacyViolation, assertRoutable, effectivePrivacy, planChatContext,
  type ContentPart, type MixedPrivacyMode, type Privacy,
} from '../../src/worker/ai/privacy.ts';
import { AI_TASKS, AiConfigError, DEFAULT_AI_MODELS, NoPrivateRoute, parseAiModels, routeFor } from '../../src/worker/ai/config.ts';
import { PROVIDERS, type ProviderId } from '../../src/worker/ai/providers.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = {
  ok(c: unknown, m?: string): void;
  equal(a: unknown, b: unknown, m?: string): void;
  throws(fn: () => unknown, m?: string): void;
};

// mulberry32: small deterministic PRNG so failures are reproducible from the seed.
type Rand = () => number;
function rng(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomParts(next: Rand): ContentPart[] {
  const n = Math.floor(next() * 12);
  return Array.from({ length: n }, (_, i) => ({
    privacy: (next() < 0.3 ? 'personal' : 'published') as Privacy,
    text: `passage ${i}`,
    passageId: `p${i}`,
  }));
}

const part = (privacy: Privacy, id = 'x'): ContentPart => ({ privacy, text: id, passageId: id });

export function register(test: TestFn, assert: Assert): void {
  test('privacy: effectivePrivacy is personal if any part is personal', () => {
    assert.equal(effectivePrivacy([]), 'published');
    assert.equal(effectivePrivacy([part('published'), part('published')]), 'published');
    assert.equal(effectivePrivacy([part('published'), part('personal')]), 'personal');
  });

  test('privacy: personal content to Gemini (free tier) throws PrivacyViolation', () => {
    let caught: unknown = null;
    try {
      assertRoutable('gemini', [part('published'), part('personal'), part('personal')]);
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof PrivacyViolation, 'expected PrivacyViolation');
    assert.equal((caught as PrivacyViolation).personalParts, 2);
  });

  test('privacy: a missing or corrupted label is treated as personal', () => {
    const bad = { text: 'x' } as unknown as ContentPart;
    assert.throws(() => assertRoutable('gemini', [bad]));
  });

  test('privacy: private providers accept personal content', () => {
    assertRoutable('workers_ai', [part('personal')]);
    assertRoutable('claude', [part('personal')]);
  });

  test('privacy PROPERTY: no personal part ever reaches a provider that trains on free-tier data (5,000 cases)', () => {
    const next = rng(20261126);
    const providers = Object.keys(PROVIDERS) as ProviderId[];
    const modes: MixedPrivacyMode[] = ['private_all', 'gemini_published_only'];
    for (let i = 0; i < 5000; i += 1) {
      const parts = randomParts(next);
      const provider = providers[Math.floor(next() * providers.length)] as ProviderId;
      const hasPersonal = parts.some((p) => p.privacy === 'personal');
      let threw = false;
      try {
        assertRoutable(provider, parts);
      } catch (e) {
        threw = e instanceof PrivacyViolation;
      }
      const shouldThrow = PROVIDERS[provider].trainsOnFreeTier && hasPersonal;
      assert.equal(threw, shouldThrow, `case ${i}: provider=${provider} personal=${hasPersonal}`);

      // End to end through config routing: whatever is chosen must be safe for the parts sent.
      const mode = modes[Math.floor(next() * modes.length)] as MixedPrivacyMode;
      const plan = planChatContext(parts, mode);
      const ref = routeFor(DEFAULT_AI_MODELS, 'chat', plan.privacy, plan.parts);
      if (PROVIDERS[ref.provider].trainsOnFreeTier) {
        assert.ok(plan.parts.every((p) => p.privacy === 'published'), `case ${i}: personal part routed to ${ref.provider}`);
      }
    }
  });

  test('privacy: chat plan, private_all keeps notes and routes privately (PRV-03 default)', () => {
    const plan = planChatContext([part('published', 'a'), part('personal', 'b')], 'private_all');
    assert.equal(plan.privacyRoute, 'private_all');
    assert.equal(plan.parts.length, 2);
    assert.equal(routeFor(DEFAULT_AI_MODELS, 'chat', plan.privacy, plan.parts).provider, 'workers_ai');
  });

  test('privacy: chat plan, gemini_published_only drops personal passages and reports how many', () => {
    const plan = planChatContext([part('published', 'a'), part('personal', 'b'), part('personal', 'c')], 'gemini_published_only');
    assert.equal(plan.privacyRoute, 'published_only');
    assert.equal(plan.parts.length, 1);
    assert.equal(plan.droppedPersonal, 2);
    assert.equal(routeFor(DEFAULT_AI_MODELS, 'chat', plan.privacy, plan.parts).provider, 'gemini');
  });

  test('privacy: empty context is "no_context" and safe for any route', () => {
    const plan = planChatContext([], 'private_all');
    assert.equal(plan.privacyRoute, 'no_context');
  });

  test('config: defaults never route personal content to a free-tier-training provider', () => {
    for (const task of AI_TASKS) {
      const personal = DEFAULT_AI_MODELS[task].personal;
      if (personal) assert.ok(!PROVIDERS[personal.provider].trainsOnFreeTier, `${task}.personal is unsafe`);
    }
  });

  test('config: AI_MODELS that sends personal content to Gemini is rejected at parse time', () => {
    const raw = JSON.stringify({ chat: { published: { provider: 'gemini', model: 'm' }, personal: { provider: 'gemini', model: 'm' } } });
    assert.throws(() => parseAiModels(raw));
    let err: unknown = null;
    try { parseAiModels(raw); } catch (e) { err = e; }
    assert.ok(err instanceof AiConfigError);
  });

  test('config: overrides merge with defaults; bad JSON, unknown tasks and providers are rejected', () => {
    const cfg = parseAiModels(JSON.stringify({ embed: { published: { provider: 'workers_ai', model: 'x' }, personal: { provider: 'workers_ai', model: 'x' } } }));
    assert.equal(cfg.embed.published.model, 'x');
    assert.equal(cfg.chat.published.model, DEFAULT_AI_MODELS.chat.published.model);
    assert.equal(parseAiModels(undefined).chat.personal?.provider, 'workers_ai');
    assert.throws(() => parseAiModels('{not json'));
    assert.throws(() => parseAiModels(JSON.stringify({ telepathy: {} })));
    assert.throws(() => parseAiModels(JSON.stringify({ chat: { published: { provider: 'openai', model: 'm' } } })));
    assert.throws(() => parseAiModels(JSON.stringify({ chat: { published: { provider: 'gemini', model: '' } } })));
  });

  test('config: tasks without a private route refuse personal content', () => {
    let err: unknown = null;
    try { routeFor(DEFAULT_AI_MODELS, 'primer', 'personal', [part('personal')]); } catch (e) { err = e; }
    assert.ok(err instanceof NoPrivateRoute);
  });

  test('config: even a mislabelled request is caught by the guard on the way out', () => {
    // Caller wrongly claims "published" while a personal part is included: routeFor must still refuse.
    assert.throws(() => routeFor(DEFAULT_AI_MODELS, 'chat', 'published', [part('published'), part('personal')]));
  });
}
