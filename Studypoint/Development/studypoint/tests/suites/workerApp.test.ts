// Worker app tests with injected fakes (TESTING §7): every route requires sign-in, routing, 404/405.

import { APP_VERSION, ROUTES, createApp, type Env } from '../../src/worker/app.ts';
import type { TokenVerifier } from '../../src/worker/auth/middleware.ts';
import type { Identity } from '../../src/worker/auth/policy.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = {
  ok(c: unknown, m?: string): void;
  equal(a: unknown, b: unknown, m?: string): void;
  deepEqual(a: unknown, b: unknown, m?: string): void;
};

const verifier: TokenVerifier = async (token) => {
  if (token === 'good-alex') return { email: 'alex@example.com' };
  throw new Error('bad token');
};

const ENV = {
  ASSETS: { fetch: async () => new Response('<!doctype html>asset', { status: 200 }) } as unknown as Fetcher,
  ENVIRONMENT: 'production',
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'aud-123',
  ALLOWED_EMAILS: 'alex@example.com',
} as Env;

const BASE = 'https://studypoint.someone.workers.dev';
const signedIn = { 'Cf-Access-Jwt-Assertion': 'good-alex' };

export function register(test: TestFn, assert: Assert): void {
  test('app: EVERY registered /api route returns 401 without a token (route-table walk)', async () => {
    const app = createApp({ makeVerifier: () => verifier });
    assert.ok(ROUTES.length > 0);
    for (const route of ROUTES) {
      const res = await app.fetch(new Request(BASE + route.path, { method: route.method }), ENV);
      assert.equal(res.status, 401, `${route.method} ${route.path}`);
    }
  });

  test('app: unknown /api routes are also hidden behind sign-in (401, not 404)', async () => {
    const app = createApp({ makeVerifier: () => verifier });
    const res = await app.fetch(new Request(BASE + '/api/secret-thing'), ENV);
    assert.equal(res.status, 401);
  });

  test('app: signed in, health and /api/me respond; the identity is passed on', async () => {
    const seen: Identity[] = [];
    const app = createApp({ makeVerifier: () => verifier, resolveUserId: async (_env, id) => { seen.push(id); return null; } });
    const health = await app.fetch(new Request(BASE + '/api/health', { headers: signedIn }), ENV);
    assert.deepEqual(await health.json(), { status: 'ok', service: 'studypoint', version: APP_VERSION });
    const me = await app.fetch(new Request(BASE + '/api/me', { headers: signedIn }), ENV);
    // No OWNER_EMAILS: the ALLOWED_EMAILS person is the owner (AUTH-07, one-click deploys).
    assert.deepEqual(await me.json(), { email: 'alex@example.com', via: 'access', owner: true });
    assert.equal(seen.length, 2);
  });

  test('app: signed in, wrong method gets 405 and an unknown route gets 404', async () => {
    const app = createApp({ makeVerifier: () => verifier });
    const post = await app.fetch(new Request(BASE + '/api/health', { method: 'POST', headers: signedIn }), ENV);
    assert.equal(post.status, 405);
    const missing = await app.fetch(new Request(BASE + '/api/nope', { headers: signedIn }), ENV);
    assert.equal(missing.status, 404);
  });

  test('app: missing Access config returns 503 and never calls the verifier', async () => {
    let called = false;
    const app = createApp({ makeVerifier: () => async () => { called = true; return { email: 'alex@example.com' }; } });
    const res = await app.fetch(new Request(BASE + '/api/me', { headers: signedIn }), { ...ENV, ACCESS_AUD: '' });
    assert.equal(res.status, 503);
    assert.ok(!called);
  });

  test('app: export and import answer 503 while the database isn\'t bound yet', async () => {
    const app = createApp({ makeVerifier: () => verifier });
    const exp = await app.fetch(new Request(BASE + '/api/export', { headers: signedIn }), ENV);
    assert.equal(exp.status, 503);
    const imp = await app.fetch(new Request(BASE + '/api/import', { method: 'POST', headers: signedIn, body: '{}' }), ENV);
    assert.equal(imp.status, 503);
  });

  test('app: a crashing handler returns a plain 500 without internals', async () => {
    const app = createApp({ makeVerifier: () => verifier, resolveUserId: async () => 'u1' });
    const env = { ...ENV, DB: { prepare() { throw new Error('SELECT secret FROM internals'); } } as unknown as D1Database };
    const res = await app.fetch(new Request(BASE + '/api/export', { headers: signedIn }), env);
    assert.equal(res.status, 500);
    assert.ok(!(await res.text()).includes('secret'));
  });

  test('app: non-API paths are served from static assets', async () => {
    const app = createApp({ makeVerifier: () => verifier });
    const res = await app.fetch(new Request(BASE + '/library'), ENV);
    assert.equal(res.status, 200);
    assert.ok((await res.text()).includes('asset'));
  });
}
