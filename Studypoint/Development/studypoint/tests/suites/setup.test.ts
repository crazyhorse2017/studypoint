// AUTH-07 first-run setup: config merging, workers.dev parsing, the Cloudflare call sequence against a
// fake API, and the setup route's rules (only before setup, never trusting emails from the request).

import { effectiveEnv, isPlaceholder, needsSetup } from '../../src/worker/setup/config.ts';
import { LOGIN_DESIGN, PEOPLE_POLICY_NAME, parseWorkersDevHost, runSetup } from '../../src/worker/setup/cloudflare.ts';
import { createApp, type Env } from '../../src/worker/app.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

type Call = { method: string; path: string; body: Record<string, unknown> | null; auth: string | null };
type FakeOptions = { subdomain?: string; hasOrg?: boolean; orgDesign?: Record<string, unknown>; zeroTrustOff?: boolean };

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A tiny stand-in for the Cloudflare API: one account, one Worker, Access state that setup builds up. */
function fakeCloudflare(opts: FakeOptions = {}) {
  const calls: Call[] = [];
  const apps: Array<Record<string, unknown>> = [];
  const policies = new Map<string, Array<Record<string, unknown>>>();
  let org: Record<string, unknown> | null = opts.hasOrg ? { auth_domain: 'existing.cloudflareaccess.com', login_design: opts.orgDesign ?? {} } : null;
  let idps: Array<Record<string, unknown>> = [];
  const ok = (result: unknown) => new Response(JSON.stringify({ success: true, result }), { status: 200 });
  const fail = (status: number) => new Response(JSON.stringify({ success: false, errors: [{ message: 'no' }] }), { status });
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://api.cloudflare.com/client/v4', '');
    const method = String(init.method ?? 'GET');
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, path, body, auth: new Headers(init.headers).get('Authorization') });
    if (new Headers(init.headers).get('Authorization') !== `Bearer ${TOKEN}`) return fail(401);
    const A = '/accounts/acct1';
    if (path.startsWith('/accounts?')) return ok([{ id: 'acct1' }]);
    if (path === `${A}/workers/subdomain`) return ok({ subdomain: opts.subdomain ?? 'alex' });
    if (path === `${A}/workers/scripts/studyflare/settings`) return ok({});
    if (path === `${A}/access/organizations`) {
      if (method === 'GET') return org ? ok(org) : fail(404);
      if (method === 'POST') {
        if (opts.zeroTrustOff) return fail(400);
        org = { auth_domain: body?.['auth_domain'], login_design: body?.['login_design'] };
        return ok(org);
      }
      if (method === 'PATCH') { org = { ...(org ?? {}), login_design: body?.['login_design'] }; return ok(org); }
    }
    if (path === `${A}/access/identity_providers`) {
      if (method === 'GET') return ok(idps);
      idps = [...idps, body ?? {}];
      return ok(body);
    }
    if (path.startsWith(`${A}/access/apps?`)) return ok(apps);
    if (path === `${A}/access/apps` && method === 'POST') {
      const app = { ...(body ?? {}), id: `app${apps.length + 1}`, aud: `aud${apps.length + 1}` };
      apps.push(app);
      return ok(app);
    }
    const pm = /^\/accounts\/acct1\/access\/apps\/([^/]+)\/policies(?:\/([^/]+))?$/.exec(path);
    if (pm && pm[1]) {
      const list = policies.get(pm[1]) ?? [];
      if (method === 'GET') return ok(list);
      const p = { ...(body ?? {}), id: pm[2] ?? `pol${list.length + 1}` };
      policies.set(pm[1], [...list.filter((x) => x['id'] !== p.id), p]);
      return ok(p);
    }
    return fail(404);
  }) as unknown as typeof fetch;
  return { f, calls, apps, policies, getOrg: () => org, getIdps: () => idps };
}

const HOST = 'studyflare.alex.workers.dev';

export function register(test: TestFn, assert: Assert): void {
  test('setup config: "todo" and empty count as unset; wrangler values win over stored ones', () => {
    assert.ok(isPlaceholder('todo') && isPlaceholder(' TODO ') && isPlaceholder('') && isPlaceholder(undefined));
    assert.ok(!isPlaceholder('aud-1'));
    const stored = { team_domain: 'me.cloudflareaccess.com', aud: 'stored-aud', account_id: 'a', app_id: 'b', policy_id: 'c' };
    const merged = effectiveEnv({ ACCESS_TEAM_DOMAIN: 'todo', ACCESS_AUD: 'todo' }, stored);
    assert.equal(merged.ACCESS_AUD, 'stored-aud');
    assert.equal(merged.ACCESS_POLICY_ID, 'c');
    assert.ok(!needsSetup(merged));
    const pinned = effectiveEnv({ ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com', ACCESS_AUD: 'wrangler-aud' }, stored);
    assert.equal(pinned.ACCESS_AUD, 'wrangler-aud');
    assert.ok(needsSetup(effectiveEnv({ ACCESS_TEAM_DOMAIN: 'todo', ACCESS_AUD: 'todo' }, {})));
  });

  test('setup: only workers.dev addresses are accepted', () => {
    assert.deepEqual(parseWorkersDevHost('StudyFlare.Alex.workers.dev'), { script: 'studyflare', subdomain: 'alex' });
    assert.equal(parseWorkersDevHost('studyflare.example.com'), null);
    assert.equal(parseWorkersDevHost('a.b.c.workers.dev'), null);
  });

  test('setup: a fresh account gets a branded login, email PIN, the app, the email policy and a logo bypass', async () => {
    const cf = fakeCloudflare();
    const out = await runSetup({ token: TOKEN, host: HOST, emails: ['me@example.com'], fetchImpl: cf.f });
    assert.ok(out.orgCreated && out.branded);
    assert.equal(out.stored.team_domain, 'alex.cloudflareaccess.com');
    assert.equal(out.stored.account_id, 'acct1');
    assert.equal(out.stored.aud, 'aud1');
    const design = (cf.getOrg()?.['login_design'] ?? {}) as Record<string, unknown>;
    assert.equal(design['header_text'], LOGIN_DESIGN.header_text);
    assert.equal(design['logo_path'], `https://${HOST}/brand/logo.svg`);
    assert.ok(cf.getIdps().some((p) => p['type'] === 'onetimepin'));
    assert.deepEqual(cf.apps.map((a) => a['domain']), [HOST, `${HOST}/brand`]);
    const main = cf.policies.get('app1') ?? [];
    assert.equal(main[0]?.['name'], PEOPLE_POLICY_NAME);
    assert.equal(main[0]?.['decision'], 'allow');
    assert.deepEqual(main[0]?.['include'], [{ email: { email: 'me@example.com' } }]);
    assert.equal((cf.policies.get('app2') ?? [])[0]?.['decision'], 'bypass', 'only the logo path is public');
    assert.ok(cf.calls.every((c) => c.auth === `Bearer ${TOKEN}`));
  });

  test('setup: an existing, customised login page (e.g. shared with another app) is left alone', async () => {
    const cf = fakeCloudflare({ hasOrg: true, orgDesign: { header_text: 'My other app' } });
    const out = await runSetup({ token: TOKEN, host: HOST, emails: ['me@example.com'], fetchImpl: cf.f });
    assert.ok(!out.orgCreated && !out.branded);
    assert.equal(out.stored.team_domain, 'existing.cloudflareaccess.com');
    assert.ok(!cf.calls.some((c) => c.method === 'PATCH'), 'no branding change');
    assert.deepEqual(cf.apps.map((a) => a['domain']), [HOST], 'no logo bypass needed');
  });

  test('setup: running twice reuses the app and updates the policy instead of duplicating', async () => {
    const cf = fakeCloudflare();
    await runSetup({ token: TOKEN, host: HOST, emails: ['me@example.com'], fetchImpl: cf.f });
    const again = await runSetup({ token: TOKEN, host: HOST, emails: ['me@example.com', 'me2@example.com'], fetchImpl: cf.f });
    assert.equal(cf.apps.length, 2);
    assert.equal(again.stored.policy_id, 'pol1');
    assert.equal((cf.policies.get('app1') ?? []).length, 1);
  });

  test('setup: a token for a different account, a bad token, no Zero Trust, or no emails all fail clearly', async () => {
    const msg = async (p: Promise<unknown>) => { try { await p; return ''; } catch (e) { return (e as Error).message; } };
    assert.ok((await msg(runSetup({ token: TOKEN, host: 'studyflare.someoneelse.workers.dev', emails: ['me@example.com'], fetchImpl: fakeCloudflare().f }))).includes("can't see the Cloudflare account"));
    assert.ok((await msg(runSetup({ token: 'zyxwvutsrqponmlkjihgfedcba987654321', host: HOST, emails: ['me@example.com'], fetchImpl: fakeCloudflare().f }))).includes("didn't accept that token"));
    assert.ok((await msg(runSetup({ token: TOKEN, host: HOST, emails: ['me@example.com'], fetchImpl: fakeCloudflare({ zeroTrustOff: true }).f }))).includes('Zero Trust'));
    assert.ok((await msg(runSetup({ token: TOKEN, host: HOST, emails: [], fetchImpl: fakeCloudflare().f }))).includes('ALLOWED_EMAILS is empty'));
    assert.ok((await msg(runSetup({ token: 'short', host: HOST, emails: ['me@example.com'], fetchImpl: fakeCloudflare().f }))).includes("doesn't look like"));
  });

  test('setup route: answers without sign-in only before setup, stores the result, then refuses', async () => {
    const cf = fakeCloudflare();
    const table = new Map<string, string>();
    const db = {
      prepare: (sql: string) => {
        const stmt = (args: unknown[]) => ({
          bind: (...a: unknown[]) => stmt(a),
          async all() {
            if (sql.startsWith('SELECT key, value FROM app_config')) return { results: [...table.entries()].map(([key, value]) => ({ key, value })) };
            throw new Error('unexpected ' + sql);
          },
          sql, args,
        });
        return stmt([]);
      },
      async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
        for (const s of stmts) table.set(String(s.args[0]), String(s.args[1]));
        return [];
      },
    } as unknown as D1Database;
    const env = { ASSETS: {} as Fetcher, ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 'todo', ACCESS_AUD: 'todo', ALLOWED_EMAILS: 'me@example.com', DB: db } as Env;
    const app = createApp({ makeVerifier: () => async () => ({ email: 'me@example.com' }), fetchImpl: cf.f });
    const base = `https://${HOST}`;

    const me = await app.fetch(new Request(base + '/api/me'), env);
    assert.equal(me.status, 503);
    assert.equal(((await me.json()) as { error: { code: string } }).error.code, 'setup_required');

    const status = (await (await app.fetch(new Request(base + '/api/setup'), env)).json()) as Record<string, unknown>;
    assert.deepEqual(status, { needed: true, emailsSet: true, host: HOST });

    const post = await app.fetch(new Request(base + '/api/setup', { method: 'POST', body: JSON.stringify({ token: TOKEN, emails: ['attacker@example.com'] }) }), env);
    assert.equal(post.status, 200);
    assert.deepEqual((cf.policies.get('app1') ?? [])[0]?.['include'], [{ email: { email: 'me@example.com' } }], 'emails in the request are ignored');
    assert.equal(table.get('aud'), 'aud1');
    assert.ok(![...table.values()].includes(TOKEN), 'the token is never stored');

    const again = await app.fetch(new Request(base + '/api/setup', { method: 'POST', body: JSON.stringify({ token: TOKEN }) }), env);
    assert.equal(again.status, 409);
    const anon = await app.fetch(new Request(base + '/api/me'), env);
    assert.equal(anon.status, 401, 'after setup, sign-in is required');
  });
}
