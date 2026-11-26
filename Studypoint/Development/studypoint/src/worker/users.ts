// Resolve a signed-in identity to a user row (AUTH-03b). First sign-in creates the user row, a default
// settings row and the email link. Nothing else is created (LIB-12, NFR-DATA).
// Studypoint is single-user: every allowed Access login links to the ONE owner account, so Alex sees the
// same library with his school or personal email. CI and dev identities get separate users.

import { uuid7 } from '../shared/uuid7.ts';
import { CI_USER_EMAIL, type Identity } from './auth/policy.ts';

export type UserRow = { id: string; email: string };

export type UserResolution =
  | { action: 'existing'; userId: string }
  | { action: 'link'; userId: string }
  | { action: 'create' };

/** Pure decision. `linked` = user already linked to this email; `owner` = the existing owner account, if any. */
export function resolveUser(identity: Identity, linked: UserRow | null, owner: UserRow | null): UserResolution {
  if (linked) return { action: 'existing', userId: linked.id };
  if (identity.via === 'access' && owner) return { action: 'link', userId: owner.id };
  return { action: 'create' };
}

const OWNER_SQL = `SELECT id, email FROM users WHERE email <> ? ORDER BY created_at ASC, id ASC LIMIT 1`;
const LINKED_SQL = `SELECT u.id AS id, u.email AS email FROM user_emails e JOIN users u ON u.id = e.user_id WHERE e.email = ?`;

export async function ensureUser(db: D1Database, identity: Identity, now: number = Date.now()): Promise<UserRow> {
  const email = identity.email.trim().toLowerCase();
  const linked = await db.prepare(LINKED_SQL).bind(email).first<UserRow>();
  const owner = identity.via === 'access' ? await db.prepare(OWNER_SQL).bind(CI_USER_EMAIL).first<UserRow>() : null;
  const decision = resolveUser({ ...identity, email }, linked, owner);

  if (decision.action === 'existing') return linked as UserRow;
  if (decision.action === 'link') {
    await db.prepare('INSERT OR IGNORE INTO user_emails (email, user_id, created_at) VALUES (?, ?, ?)').bind(email, decision.userId, now).run();
    return owner as UserRow;
  }

  const id = uuid7(now);
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO users (id, email, created_at) VALUES (?, ?, ?)').bind(id, email, now),
    db.prepare('INSERT OR IGNORE INTO user_emails (email, user_id, created_at) SELECT ?, id, ? FROM users WHERE email = ?').bind(email, now, email),
    db.prepare('INSERT OR IGNORE INTO settings (user_id, updated_at) SELECT id, ? FROM users WHERE email = ?').bind(now, email),
  ]);
  // Re-read: if two first requests raced, the other one's rows won and this returns them.
  const row = await db.prepare(LINKED_SQL).bind(email).first<UserRow>();
  if (!row) throw new Error('User row missing after insert');
  return row;
}
