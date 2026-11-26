// Cloudflare Access JWT verification with jose (ARCHITECTURE A3, AUTH-02), as in Cloudflare's
// "Validate JWTs" guide and NoteFlare's worker/auth.ts: signature against the team's public keys,
// plus issuer and audience. Tested in CI (pool-workers); the policy around it is tested locally.

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AccessClaims } from './policy.ts';
import type { TokenVerifier } from './middleware.ts';

type JwkSet = ReturnType<typeof createRemoteJWKSet>;
const jwksCache = new Map<string, JwkSet>();

/** One key set per issuer per isolate; jose caches and refreshes the keys itself. */
function keySetFor(issuer: string): JwkSet {
  let set = jwksCache.get(issuer);
  if (!set) {
    set = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, set);
  }
  return set;
}

export function createAccessVerifier(issuer: string, aud: string): TokenVerifier {
  return async (token: string): Promise<AccessClaims> => {
    const { payload } = await jwtVerify(token, keySetFor(issuer), {
      issuer,
      audience: aud,
      algorithms: ['RS256'],
      clockTolerance: 60,
    });
    return { email: payload['email'], common_name: payload['common_name'] };
  };
}
