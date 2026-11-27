// Owners (AUTH-03b). Every email allowed into this Studyflare opens the SAME owner account. There's no
// in-app invite system (Settings → People was removed 2026-11-26, A21): anyone else deploys their own
// copy with the Deploy to Cloudflare button (AUTH-07), which keeps everyone's data fully separate.

import { isEmailAllowed, parseAllowedEmails, type AllowList, type AuthEnv } from './auth/policy.ts';

/** OWNER_EMAILS if set; otherwise everyone in ALLOWED_EMAILS (a one-click deploy only asks for that one). */
export function owners(env: AuthEnv): AllowList {
  const explicit = parseAllowedEmails(env.OWNER_EMAILS);
  return explicit.emails.size > 0 || explicit.domains.size > 0 ? explicit : parseAllowedEmails(env.ALLOWED_EMAILS);
}

export function isOwner(env: AuthEnv, email: string): boolean {
  return isEmailAllowed(email, owners(env));
}
