// Auth policy (AUTH-01..05, ARCHITECTURE §3.2). Pure: no network, no bindings.
// Cloudflare Access does the sign-in; this decides who, having passed Access, may use the API.
// Everything here fails CLOSED: missing or odd configuration denies access, never grants it.

export type Environment = 'production' | 'preview' | 'development';

export type AllowList = { emails: ReadonlySet<string>; domains: ReadonlySet<string> };

export type AuthConfig = {
  environment: Environment;
  /** Issuer origin, e.g. https://myteam.cloudflareaccess.com (normalised). */
  issuer: string | null;
  aud: string | null;
  allowed: AllowList;
  devUserEmail: string | null;
  ciServiceTokenId: string | null;
  aiFake: boolean;
};

/** Claims we read from a verified Access JWT. Service-token JWTs carry common_name instead of email. */
export type AccessClaims = { email?: unknown; common_name?: unknown };

export type Identity = { email: string; via: 'access' | 'dev' | 'ci' };

export type AuthDecision =
  | { ok: true; identity: Identity }
  | { ok: false; status: 401 | 403 | 503; code: string; message: string };

export const CI_USER_EMAIL = 'ci@studypoint.invalid';

export type AuthEnv = {
  ENVIRONMENT?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ALLOWED_EMAILS?: string;
  DEV_USER_EMAIL?: string;
  CI_SERVICE_TOKEN_ID?: string;
  AI_FAKE?: string;
};

const clean = (v: string | undefined): string | null => (v && v.trim() !== '' ? v.trim() : null);

/** Unknown or missing values count as production: the strictest setting. */
export function parseEnvironment(raw: string | undefined): Environment {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'preview' || v === 'development' ? v : 'production';
}

/** "myteam.cloudflareaccess.com", "https://myteam.cloudflareaccess.com/" → "https://myteam.cloudflareaccess.com". */
export function normaliseIssuer(teamDomain: string | undefined): string | null {
  const v = clean(teamDomain);
  if (!v) return null;
  const host = v.replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host) || !host.includes('.')) return null;
  return `https://${host}`;
}

/** ALLOWED_EMAILS: comma/space separated addresses; "@domain" entries allow a whole domain. */
export function parseAllowedEmails(raw: string | undefined): AllowList {
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const item of (raw ?? '').split(/[\s,;]+/)) {
    const v = item.trim().toLowerCase();
    if (!v) continue;
    if (v.startsWith('@') && v.length > 2) domains.add(v.slice(1));
    else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) emails.add(v);
  }
  return { emails, domains };
}

/** An empty allowlist allows nobody (fail closed). */
export function isEmailAllowed(email: string, list: AllowList): boolean {
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0) return false;
  return list.emails.has(e) || list.domains.has(e.slice(at + 1));
}

export function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
}

export function readAuthConfig(env: AuthEnv): AuthConfig {
  return {
    environment: parseEnvironment(env.ENVIRONMENT),
    issuer: normaliseIssuer(env.ACCESS_TEAM_DOMAIN),
    aud: clean(env.ACCESS_AUD),
    allowed: parseAllowedEmails(env.ALLOWED_EMAILS),
    devUserEmail: clean(env.DEV_USER_EMAIL)?.toLowerCase() ?? null,
    ciServiceTokenId: clean(env.CI_SERVICE_TOKEN_ID),
    aiFake: clean(env.AI_FAKE) !== null && clean(env.AI_FAKE) !== '0',
  };
}

const deny = (status: 401 | 403 | 503, code: string, message: string): AuthDecision => ({ ok: false, status, code, message });

/** Configuration problems that must stop every request (checked before any token is looked at). */
export function configProblem(config: AuthConfig): AuthDecision | null {
  if (config.environment === 'production' && (config.ciServiceTokenId || config.aiFake)) {
    // AUTH-05: the CI token mapping and AI_FAKE exist only in preview. Refuse to run if they leak into production.
    return deny(503, 'unsafe_config', 'Studypoint is misconfigured: test-only settings are present in production.');
  }
  if (config.environment !== 'development' && (!config.issuer || !config.aud)) {
    return deny(503, 'auth_not_configured', "Sign-in isn't configured yet (ACCESS_TEAM_DOMAIN / ACCESS_AUD).");
  }
  return null;
}

/** Local dev without Access: only on localhost, never in production, and only with DEV_USER_EMAIL set (AUTH-04). */
export function devBypass(config: AuthConfig, hostname: string): AuthDecision | null {
  if (config.environment === 'production' || !config.devUserEmail || !isLocalHost(hostname)) return null;
  return { ok: true, identity: { email: config.devUserEmail, via: 'dev' } };
}

/** Decide from the claims of an Access JWT that has ALREADY been cryptographically verified. */
export function decideFromClaims(config: AuthConfig, claims: AccessClaims): AuthDecision {
  if (typeof claims.email === 'string' && claims.email.includes('@')) {
    const email = claims.email.trim().toLowerCase();
    if (isEmailAllowed(email, config.allowed)) return { ok: true, identity: { email, via: 'access' } };
    return deny(403, 'not_allowed', "This account isn't allowed to use Studypoint.");
  }
  if (
    config.environment === 'preview' &&
    config.ciServiceTokenId !== null &&
    typeof claims.common_name === 'string' &&
    claims.common_name === config.ciServiceTokenId
  ) {
    return { ok: true, identity: { email: CI_USER_EMAIL, via: 'ci' } };
  }
  return deny(403, 'not_allowed', "This account isn't allowed to use Studypoint.");
}
