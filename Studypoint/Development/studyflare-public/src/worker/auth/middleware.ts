// Authenticate an API request (AUTH-01..05). The JWT verifier is injected so the policy can be
// tested without network access; production uses the jose verifier in ./accessJwt.ts.

import {
  configProblem, decideFromClaims, devBypass,
  type AccessClaims, type AuthConfig, type AuthDecision,
} from './policy.ts';

export type TokenVerifier = (token: string) => Promise<AccessClaims>;

/** The CF_Authorization value from a Cookie header, or null. */
export function accessTokenFromCookie(cookieHeader: string | null): string | null {
  for (const piece of (cookieHeader ?? '').split(';')) {
    const [name, ...rest] = piece.trim().split('=');
    if (name === 'CF_Authorization' && rest.length > 0) {
      const value = rest.join('=').trim();
      if (value !== '') return value;
    }
  }
  return null;
}

/** Cloudflare recommends the header; the CF_Authorization cookie is the fallback. */
export function extractAccessToken(request: Request): string | null {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header && header.trim() !== '') return header.trim();
  return accessTokenFromCookie(request.headers.get('Cookie'));
}

export async function authenticate(request: Request, config: AuthConfig, verify: TokenVerifier): Promise<AuthDecision> {
  const problem = configProblem(config);
  if (problem) return problem;

  const token = extractAccessToken(request);
  if (!token) {
    const dev = devBypass(config, new URL(request.url).hostname);
    if (dev) return dev;
    return { ok: false, status: 401, code: 'unauthenticated', message: 'Sign in to use Studyflare.' };
  }

  let claims: AccessClaims;
  try {
    claims = await verify(token);
  } catch {
    // Never echo verifier details (they can include token fragments).
    return { ok: false, status: 401, code: 'invalid_token', message: 'Your sign-in has expired or is invalid. Reload to sign in again.' };
  }
  return decideFromClaims(config, claims);
}
