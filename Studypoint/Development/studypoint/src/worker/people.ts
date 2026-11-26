// People (AUTH-06): owners invite more email accounts from Settings → People.
// Both locks stay in sync: the app's allowed_emails table AND the Cloudflare Access policy.
// If the Cloudflare update fails, the database change is rolled back, so the two never disagree for long.

import { isEmailAllowed, parseAllowedEmails, type AllowList } from './auth/policy.ts';

export type PeopleEnv = {
  ALLOWED_EMAILS?: string;
  OWNER_EMAILS?: string;
  /** Cloudflare API token limited to editing Access apps/policies (Worker SECRET). */
  CF_ACCESS_API_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  ACCESS_APP_ID?: string;
  ACCESS_POLICY_ID?: string;
};

export type Person = { email: string; role: 'owner' | 'member'; builtIn: boolean; addedAt: number | null };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normaliseEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  return e.length <= 254 && EMAIL_RE.test(e) ? e : null;
}

export function owners(env: PeopleEnv): AllowList {
  return parseAllowedEmails(env.OWNER_EMAILS);
}

export function isOwner(env: PeopleEnv, email: string): boolean {
  return isEmailAllowed(email, owners(env));
}

export async function isInvited(db: D1Database, email: string): Promise<boolean> {
  return (await db.prepare('SELECT 1 AS ok FROM allowed_emails WHERE email = ?').bind(email).first()) !== null;
}

export async function listPeople(db: D1Database, env: PeopleEnv): Promise<Person[]> {
  const builtIn = parseAllowedEmails(env.ALLOWED_EMAILS);
  const ownerList = owners(env);
  const out: Person[] = [...builtIn.emails].map((email) => ({ email, role: isEmailAllowed(email, ownerList) ? 'owner' : 'member', builtIn: true, addedAt: null }));
  const rows = await db.prepare('SELECT email, created_at FROM allowed_emails ORDER BY created_at ASC').all<{ email: string; created_at: number }>();
  for (const r of rows.results) if (!builtIn.emails.has(r.email)) out.push({ email: r.email, role: 'member', builtIn: false, addedAt: r.created_at });
  return out;
}

/** Every email Cloudflare Access should allow: the built-in list plus invited people. */
export async function allEmails(db: D1Database, env: PeopleEnv): Promise<string[]> {
  return (await listPeople(db, env)).map((p) => p.email).sort();
}

export class PeopleError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PeopleError';
    this.status = status;
  }
}

/** Replace the Access policy's include list with exactly these emails. */
export async function syncAccessPolicy(env: PeopleEnv, emails: readonly string[], fetchImpl: typeof fetch = fetch): Promise<void> {
  const { CF_ACCESS_API_TOKEN: token, CF_ACCOUNT_ID: account, ACCESS_APP_ID: app, ACCESS_POLICY_ID: policy } = env;
  if (!token || !account || !app || !policy) {
    throw new PeopleError(503, "Adding people isn't set up yet: the Cloudflare token for sign-in changes is missing.");
  }
  if (emails.length === 0) throw new PeopleError(400, 'The sign-in list can’t be empty.');
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/access/apps/${app}/policies/${policy}`;
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Studyflare people', decision: 'allow', include: emails.map((email) => ({ email: { email } })) }),
  });
  if (!res.ok) throw new PeopleError(502, "Cloudflare didn't accept the sign-in change. Nothing was changed. Try again.");
}

export async function addPerson(db: D1Database, env: PeopleEnv, email: string, addedBy: string, now = Date.now(), fetchImpl?: typeof fetch): Promise<Person[]> {
  if ((await listPeople(db, env)).some((p) => p.email === email)) throw new PeopleError(409, `${email} can already sign in.`);
  await db.prepare('INSERT INTO allowed_emails (email, role, added_by_user_id, created_at) VALUES (?, ?, ?, ?)').bind(email, 'member', addedBy, now).run();
  try {
    await syncAccessPolicy(env, await allEmails(db, env), fetchImpl);
  } catch (err) {
    await db.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(email).run(); // roll back
    throw err;
  }
  return listPeople(db, env);
}

export async function removePerson(db: D1Database, env: PeopleEnv, email: string, fetchImpl?: typeof fetch): Promise<Person[]> {
  const people = await listPeople(db, env);
  const p = people.find((x) => x.email === email);
  if (!p) throw new PeopleError(404, `${email} isn't on the list.`);
  if (p.builtIn) throw new PeopleError(400, `${email} is built in and can’t be removed here.`);
  await db.prepare('DELETE FROM allowed_emails WHERE email = ?').bind(email).run();
  try {
    await syncAccessPolicy(env, await allEmails(db, env), fetchImpl);
  } catch (err) {
    await db.prepare('INSERT OR IGNORE INTO allowed_emails (email, role, created_at) VALUES (?, ?, ?)').bind(email, 'member', Date.now()).run();
    throw err;
  }
  return listPeople(db, env);
}
