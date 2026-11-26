// AUTH-06 People: sync with Cloudflare Access, rollback on failure, owner-only routes, invited sign-in.

import { addPerson, isOwner, listPeople, normaliseEmail, removePerson, syncAccessPolicy, type PeopleEnv } from '../../src/worker/people.ts';
import { authenticate } from '../../src/worker/auth/middleware.ts';
import { readAuthConfig } from '../../src/worker/auth/policy.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

/** Minimal in-memory stand-in for the allowed_emails queries in people.ts. Unknown SQL throws. */
function fakeDb() {
  const rows = new Map<string, number>();
  const stmt = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => stmt(sql, a),
    async first() {
      if (sql.startsWith('SELECT 1 AS ok FROM allowed_emails')) return rows.has(args[0] as string) ? { ok: 1 } : null;
      throw new Error('unexpected first: ' + sql);
    },
    async all() {
      if (sql.startsWith('SELECT email, created_at FROM allowed_emails')) {
        return { results: [...rows.entries()].sort((a, b) => a[1] - b[1]).map(([email, created_at]) => ({ email, created_at })) };
      }
      throw new Error('unexpected all: ' + sql);
    },
    async run() {
      if (sql.startsWith('INSERT INTO allowed_emails')) {
        if (rows.has(args[0] as string)) throw new Error('UNIQUE constraint failed');
        rows.set(args[0] as string, args[3] as number);
      } else if (sql.startsWith('INSERT OR IGNORE INTO allowed_emails')) {
        if (!rows.has(args[0] as string)) rows.set(args[0] as string, args[2] as number);
      } else if (sql.startsWith('DELETE FROM allowed_emails')) {
        rows.delete(args[0] as string);
      } else throw new Error('unexpected run: ' + sql);
      return { meta: { changes: 1 } };
    },
  });
  return { db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database, rows };
}

const ENV: PeopleEnv = {
  ALLOWED_EMAILS: 'owner@example.edu, owner2@example.com',
  OWNER_EMAILS: 'owner@example.edu, owner2@example.com',
  CF_ACCESS_API_TOKEN: 'test-token',
  CF_ACCOUNT_ID: 'acct',
  ACCESS_APP_ID: 'app',
  ACCESS_POLICY_ID: 'pol',
};

function recordingFetch(ok = true) {
  const calls: Array<{ url: string; method: string; body: { include: Array<{ email: { email: string } }> }; auth: string | null }> = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: String(init.method), body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('Authorization') });
    return new Response('{}', { status: ok ? 200 : 403 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

export function register(test: TestFn, assert: Assert): void {
  test('people: emails are normalised and validated', () => {
    assert.equal(normaliseEmail('  Friend@Example.COM '), 'friend@example.com');
    assert.equal(normaliseEmail('not-an-email'), null);
    assert.equal(normaliseEmail(42), null);
  });

  test('people: adding someone updates the app list AND the Cloudflare policy with everyone', async () => {
    const { db, rows } = fakeDb();
    const { f, calls } = recordingFetch(true);
    const people = await addPerson(db, ENV, 'friend@example.com', 'u1', 10, f);
    assert.ok(rows.has('friend@example.com'));
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, 'PUT');
    assert.equal(calls[0]?.url, 'https://api.cloudflare.com/client/v4/accounts/acct/access/apps/app/policies/pol');
    assert.equal(calls[0]?.auth, 'Bearer test-token');
    assert.deepEqual(calls[0]?.body.include.map((i) => i.email.email), ['friend@example.com', 'owner2@example.com', 'owner@example.edu']);
    assert.deepEqual(people.map((p) => [p.email, p.role, p.builtIn]), [
      ['owner@example.edu', 'owner', true],
      ['owner2@example.com', 'owner', true],
      ['friend@example.com', 'member', false],
    ]);
  });

  test('people: if Cloudflare refuses, the add is rolled back so the two lists never disagree', async () => {
    const { db, rows } = fakeDb();
    const { f } = recordingFetch(false);
    let threw = false;
    try {
      await addPerson(db, ENV, 'friend@example.com', 'u1', 10, f);
    } catch {
      threw = true;
    }
    assert.ok(threw);
    assert.ok(!rows.has('friend@example.com'), 'rolled back');
  });

  test('people: missing Access app ids give a clear "not set up" error and change nothing', async () => {
    const { db, rows } = fakeDb();
    let msg = '';
    try {
      await addPerson(db, { ...ENV, ACCESS_APP_ID: undefined }, 'friend@example.com', 'u1', 10, recordingFetch().f);
    } catch (e) {
      msg = (e as Error).message;
    }
    assert.ok(msg.includes('isn’t set up') || msg.includes("isn't set up"), msg);
    assert.equal(rows.size, 0);
  });

  test('people: duplicates and built-in owners are refused; removal syncs and rolls back on failure', async () => {
    const { db, rows } = fakeDb();
    await addPerson(db, ENV, 'friend@example.com', 'u1', 10, recordingFetch().f);
    let dup = '';
    try { await addPerson(db, ENV, 'friend@example.com', 'u1', 11, recordingFetch().f); } catch (e) { dup = (e as Error).message; }
    assert.ok(dup.includes('already'));
    let builtIn = '';
    try { await removePerson(db, ENV, 'owner@example.edu', recordingFetch().f); } catch (e) { builtIn = (e as Error).message; }
    assert.ok(builtIn.includes('built in'), 'owners cannot be removed here');
    try { await removePerson(db, ENV, 'friend@example.com', recordingFetch(false).f); } catch { /* expected */ }
    assert.ok(rows.has('friend@example.com'), 'failed removal is rolled back');
    const { f, calls } = recordingFetch(true);
    await removePerson(db, ENV, 'friend@example.com', f);
    assert.ok(!rows.has('friend@example.com'));
    assert.deepEqual(calls[0]?.body.include.map((i) => i.email.email), ['owner2@example.com', 'owner@example.edu']);
  });

  test('people: the Cloudflare list can never be emptied', async () => {
    let msg = '';
    try { await syncAccessPolicy(ENV, [], recordingFetch().f); } catch (e) { msg = (e as Error).message; }
    assert.ok(msg.includes('empty'));
  });

  test('people: only owner emails are owners', () => {
    assert.ok(isOwner(ENV, 'OWNER@example.edu'));
    assert.ok(!isOwner(ENV, 'friend@example.com'));
    assert.ok(!isOwner({}, 'owner@example.edu'), 'no lists at all means no owners');
  });

  test('people (AUTH-07): without OWNER_EMAILS, the one-click ALLOWED_EMAILS are the owners', () => {
    const env: PeopleEnv = { ALLOWED_EMAILS: 'me@example.com' };
    assert.ok(isOwner(env, 'me@example.com'));
    assert.ok(!isOwner(env, 'friend@example.com'));
    assert.ok(!isOwner({ ...env, OWNER_EMAILS: 'other@example.com' }, 'me@example.com'), 'OWNER_EMAILS wins when set');
  });

  test('people (AUTH-07): a pasted one-time token is used for that change when no secret is stored', async () => {
    const { db, rows } = fakeDb();
    const noSecret = { ...ENV, CF_ACCESS_API_TOKEN: undefined };
    let msg = '';
    try { await addPerson(db, noSecret, 'friend@example.com', 'u1', 10, recordingFetch().f); } catch (e) { msg = (e as Error).message; }
    assert.ok(msg.includes('Paste a Cloudflare API token'), msg);
    assert.equal(rows.size, 0, 'nothing saved without a token');
    const { f, calls } = recordingFetch(true);
    await addPerson(db, noSecret, 'friend@example.com', 'u1', 10, f, 'pasted-token-123');
    assert.equal(calls[0]?.auth, 'Bearer pasted-token-123');
    assert.ok(rows.has('friend@example.com'));
  });

  test('auth: an invited email (verified by Access) is let in; a stranger is still refused', async () => {
    const cfg = readAuthConfig({ ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAILS: 'owner@example.edu' });
    const verify = async (t: string) => ({ email: t });
    const invited = async (e: string) => e === 'friend@example.com';
    const req = (email: string) => new Request('https://x.test/api/me', { headers: { 'Cf-Access-Jwt-Assertion': email } });
    const ok = await authenticate(req('Friend@Example.com'), cfg, verify, invited);
    assert.ok(ok.ok && ok.identity.email === 'friend@example.com');
    const no = await authenticate(req('stranger@example.com'), cfg, verify, invited);
    assert.ok(!no.ok && no.status === 403);
    const boom = await authenticate(req('friend@example.com'), cfg, verify, async () => { throw new Error('db down'); });
    assert.ok(!boom.ok, 'a failing lookup fails closed');
  });

  test('people: listing shows built-in emails even before anyone is invited', async () => {
    const { db } = fakeDb();
    const people = await listPeople(db, ENV);
    assert.equal(people.length, 2);
  });
}
