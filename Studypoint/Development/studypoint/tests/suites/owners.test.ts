// AUTH-03b owners. Every allowed email opens the owner account. There's no invite system (A21): anyone
// else deploys their own Studyflare, so an email that isn't allowed is always refused.

import { isOwner, owners } from '../../src/worker/owners.ts';
import { authenticate } from '../../src/worker/auth/middleware.ts';
import { readAuthConfig } from '../../src/worker/auth/policy.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

export function register(test: TestFn, assert: Assert): void {
  test('owners: OWNER_EMAILS wins when set; otherwise ALLOWED_EMAILS are the owners', () => {
    assert.ok(isOwner({ OWNER_EMAILS: 'a@example.edu, b@example.com' }, 'B@Example.com'));
    assert.ok(isOwner({ ALLOWED_EMAILS: 'me@example.com' }, 'me@example.com'));
    assert.ok(!isOwner({ ALLOWED_EMAILS: 'me@example.com', OWNER_EMAILS: 'other@example.com' }, 'me@example.com'));
    assert.ok(!isOwner({}, 'me@example.com'), 'no lists at all means no owners');
    assert.equal(owners({ ALLOWED_EMAILS: '@example.edu' }).domains.has('example.edu'), true);
  });

  test('auth (A21): with no invite list, an email outside ALLOWED_EMAILS is always refused', async () => {
    const cfg = readAuthConfig({ ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAILS: 'owner@example.edu' });
    const verify = async (t: string) => ({ email: t });
    const req = (email: string) => new Request('https://x.test/api/me', { headers: { 'Cf-Access-Jwt-Assertion': email } });
    const ok = await authenticate(req('Owner@Example.edu'), cfg, verify);
    assert.ok(ok.ok && ok.identity.email === 'owner@example.edu');
    const no = await authenticate(req('friend@example.com'), cfg, verify);
    assert.ok(!no.ok && no.status === 403);
  });
}
