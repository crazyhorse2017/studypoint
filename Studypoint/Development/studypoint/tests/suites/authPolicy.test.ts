// AUTH-01..05 policy tests (TESTING §7). Pure: verified claims are given directly.

import {
  CI_USER_EMAIL, configProblem, decideFromClaims, devBypass, isEmailAllowed, isLocalHost, normaliseIssuer,
  parseAllowedEmails, parseEnvironment, readAuthConfig, type AuthEnv,
} from '../../src/worker/auth/policy.ts';
import { accessTokenFromCookie, authenticate, extractAccessToken, type TokenVerifier } from '../../src/worker/auth/middleware.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = {
  ok(c: unknown, m?: string): void;
  equal(a: unknown, b: unknown, m?: string): void;
  deepEqual(a: unknown, b: unknown, m?: string): void;
};

const PROD: AuthEnv = {
  ENVIRONMENT: 'production',
  ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
  ACCESS_AUD: 'aud-123',
  ALLOWED_EMAILS: 'Alex@Example.com, @school.example.edu',
};

const verifier: TokenVerifier = async (token) => {
  if (token === 'good-alex') return { email: 'alex@example.com' };
  if (token === 'good-student') return { email: 'someone@school.example.edu' };
  if (token === 'good-stranger') return { email: 'stranger@example.org' };
  if (token === 'good-ci') return { common_name: 'ci-token-id' };
  throw new Error('bad signature for token ' + token);
};

const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers });

export function register(test: TestFn, assert: Assert): void {
  test('auth: unknown or missing ENVIRONMENT is treated as production', () => {
    assert.equal(parseEnvironment(undefined), 'production');
    assert.equal(parseEnvironment('staging'), 'production');
    assert.equal(parseEnvironment(' Preview '), 'preview');
    assert.equal(parseEnvironment('development'), 'development');
  });

  test('auth: team domain is normalised to an https issuer; junk is rejected', () => {
    assert.equal(normaliseIssuer('team.cloudflareaccess.com'), 'https://team.cloudflareaccess.com');
    assert.equal(normaliseIssuer('https://Team.cloudflareaccess.com/'), 'https://team.cloudflareaccess.com');
    assert.equal(normaliseIssuer(''), null);
    assert.equal(normaliseIssuer('not a domain'), null);
    assert.equal(normaliseIssuer('localhost'), null);
  });

  test('auth: allowlist parses emails and @domains, case-insensitively', () => {
    const list = parseAllowedEmails(' Alex@Example.com,  @school.example.edu ; junk ');
    assert.ok(isEmailAllowed('alex@example.com', list));
    assert.ok(isEmailAllowed('ALEX@EXAMPLE.COM', list));
    assert.ok(isEmailAllowed('anyone@school.example.edu', list));
    assert.ok(!isEmailAllowed('anyone@example.edu', list), 'parent domain must not match');
    assert.ok(!isEmailAllowed('alex@example.com.evil.test', list));
    assert.ok(!isEmailAllowed('junk', list));
  });

  test('auth: an empty allowlist allows nobody (fail closed)', () => {
    assert.ok(!isEmailAllowed('alex@example.com', parseAllowedEmails('')));
    assert.ok(!isEmailAllowed('alex@example.com', parseAllowedEmails(undefined)));
  });

  test('auth: missing Access config blocks production and preview (503), not development', () => {
    assert.equal(configProblem(readAuthConfig({ ...PROD, ACCESS_AUD: '' }))?.status, 503);
    assert.equal(configProblem(readAuthConfig({ ...PROD, ENVIRONMENT: 'preview', ACCESS_TEAM_DOMAIN: '' }))?.status, 503);
    assert.equal(configProblem(readAuthConfig({ ENVIRONMENT: 'development' })), null);
    assert.equal(configProblem(readAuthConfig(PROD)), null);
  });

  test('auth (AUTH-05): CI token or AI_FAKE present in production refuses to run', () => {
    const a = configProblem(readAuthConfig({ ...PROD, CI_SERVICE_TOKEN_ID: 'x' }));
    const b = configProblem(readAuthConfig({ ...PROD, AI_FAKE: '1' }));
    assert.equal(a?.status, 503);
    assert.equal(a && !a.ok ? a.code : '', 'unsafe_config');
    assert.equal(b?.status, 503);
    assert.equal(configProblem(readAuthConfig({ ...PROD, ENVIRONMENT: 'preview', CI_SERVICE_TOKEN_ID: 'x', AI_FAKE: '1' })), null);
  });

  test('auth (AUTH-04): dev bypass only on localhost, never in production, only with DEV_USER_EMAIL', () => {
    const dev = readAuthConfig({ ENVIRONMENT: 'development', DEV_USER_EMAIL: 'dev@example.com' });
    assert.equal(devBypass(dev, 'localhost')?.ok, true);
    assert.equal(devBypass(dev, '127.0.0.1')?.ok, true);
    assert.equal(devBypass(dev, 'studypoint.someone.workers.dev'), null);
    assert.equal(devBypass(readAuthConfig({ ...PROD, DEV_USER_EMAIL: 'dev@example.com' }), 'localhost'), null);
    assert.equal(devBypass(readAuthConfig({ ENVIRONMENT: 'development' }), 'localhost'), null);
    assert.ok(isLocalHost('app.localhost') && !isLocalHost('localhost.evil.test'));
  });

  test('auth: verified claims, allowed email passes, others get 403', () => {
    const cfg = readAuthConfig(PROD);
    const ok = decideFromClaims(cfg, { email: 'Alex@Example.com' });
    assert.ok(ok.ok && ok.identity.email === 'alex@example.com' && ok.identity.via === 'access');
    assert.equal(decideFromClaims(cfg, { email: 'stranger@example.org' }).ok, false);
    assert.equal(decideFromClaims(cfg, {}).ok, false);
    assert.equal(decideFromClaims(cfg, { email: 42 }).ok, false);
  });

  test('auth (AUTH-05): CI service token maps to the CI user on preview only', () => {
    const preview = readAuthConfig({ ...PROD, ENVIRONMENT: 'preview', CI_SERVICE_TOKEN_ID: 'ci-token-id' });
    const d = decideFromClaims(preview, { common_name: 'ci-token-id' });
    assert.ok(d.ok && d.identity.email === CI_USER_EMAIL && d.identity.via === 'ci');
    assert.equal(decideFromClaims(preview, { common_name: 'other-token' }).ok, false);
    // Production ignores service tokens entirely (and configProblem blocks the var anyway).
    const prodWithVar = { ...readAuthConfig(PROD), ciServiceTokenId: 'ci-token-id' };
    assert.equal(decideFromClaims(prodWithVar, { common_name: 'ci-token-id' }).ok, false);
  });

  // Browsers drop a `Cookie` header set on a constructed Request (forbidden header), so cookie parsing is
  // tested directly here; the full cookie-on-Request path runs in the Workers runtime in CI.
  test('auth: token comes from the Cf-Access-Jwt-Assertion header', () => {
    assert.equal(extractAccessToken(req('https://x.test/api', { 'Cf-Access-Jwt-Assertion': ' h.t.s ' })), 'h.t.s');
    assert.equal(extractAccessToken(req('https://x.test/api')), null);
  });

  test('auth: CF_Authorization cookie is the fallback token source', () => {
    assert.equal(accessTokenFromCookie('a=1; CF_Authorization=c.o.k; b=2'), 'c.o.k');
    assert.equal(accessTokenFromCookie('CF_Authorization=a=b=c'), 'a=b=c', 'values may contain "="');
    assert.equal(accessTokenFromCookie('CF_Authorization='), null);
    assert.equal(accessTokenFromCookie('XCF_Authorization=nope'), null);
    assert.equal(accessTokenFromCookie(null), null);
  });

  test('auth: authenticate() covers the whole matrix', async () => {
    const cfg = readAuthConfig(PROD);
    const url = 'https://studypoint.someone.workers.dev/api/me';
    const cases: Array<[Record<string, string>, number | 'ok']> = [
      [{}, 401],
      [{ 'Cf-Access-Jwt-Assertion': 'forged' }, 401],
      [{ 'Cf-Access-Jwt-Assertion': 'good-alex' }, 'ok'],
      [{ 'Cf-Access-Jwt-Assertion': 'good-student' }, 'ok'],
      [{ 'Cf-Access-Jwt-Assertion': 'good-stranger' }, 403],
      [{ 'Cf-Access-Jwt-Assertion': 'good-ci' }, 403],
    ];
    for (const [headers, expected] of cases) {
      const d = await authenticate(req(url, headers), cfg, verifier);
      const got = d.ok ? 'ok' : d.status;
      assert.equal(got, expected, `headers ${JSON.stringify(headers)}`);
    }
  });

  test('auth: verifier errors are never echoed to the client', async () => {
    const d = await authenticate(req('https://x.test/api/me', { 'Cf-Access-Jwt-Assertion': 'secret-token-fragment' }), readAuthConfig(PROD), verifier);
    assert.ok(!d.ok && !d.message.includes('secret-token-fragment'));
  });
}
