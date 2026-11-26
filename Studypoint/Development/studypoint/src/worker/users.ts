// Resolve a signed-in identity to a user row (AUTH-03b). First sign-in creates the user row, a default
// settings row and the email link. Nothing else is created (LIB-12, NFR-DATA).
//
// Accounts: the emails in OWNER_EMAILS (Alex's school and personal addresses) all link to ONE owner account,
// so either login shows the same library. Every other allowed email (e.g. an invited friend) gets its OWN,
// separate, empty account. CI and dev identities always get their own users.

import { uuid7 } from '../shared/uuid7.ts';
import { isEmailAllowed, type AllowList, type Identity } from './auth/policy.ts';

export type UserRow = { id: string; email: string };

export type UserResolution =
  | { action: 'existing'; userId: string }
  | { action: 'link'; userId: string }
  | { action: 'create' };

/**
 * Pure decision.
 * `linked` = user already linked to this email; `owner` = the existing owner account (found via an owner email);
 * `isOwnerEmail` = whether this login is one of OWNER_EMAILS.
 */
export function resolveUser(identity: Identity, linked: UserRow | null, owner: UserRow | null, isOwnerEmail: boolean): UserResolution {
  if (linked) return { action: 'existing', userId: linked.id };
  if (identity.via === 'access' && isOwnerEmail && owner) return { action: 'link', userId: owner.id };
  return { action: 'create' };
}

const LINKED_SQL = `SELECT u.id AS id, u.email AS email FROM user_emails e JOIN users u ON u.id = e.user_id WHERE e.email = ?`;

/** The owner account: the user linked to any of the owner emails. */
async function findOwner(db: D1Database, ownerEmails: readonly string[]): Promise<UserRow | null> {
  if (ownerEmails.length === 0) return null;
  const placeholders = ownerEmails.map(() => '?').join(', ');
  return db
    .prepare(`SELECT u.id AS id, u.email AS email FROM user_emails e JOIN users u ON u.id = e.user_id WHERE e.email IN (${placeholders}) ORDER BY u.created_at ASC LIMIT 1`)
    .bind(...ownerEmails)
    .first<UserRow>();
}

export async function ensureUser(db: D1Database, identity: Identity, owners: AllowList, now: number = Date.now()): Promise<UserRow> {
  const email = identity.email.trim().toLowerCase();
  const linked = await db.prepare(LINKED_SQL).bind(email).first<UserRow>();
  const isOwnerEmail = identity.via === 'access' && isEmailAllowed(email, owners);
  const owner = !linked && isOwnerEmail ? await findOwner(db, [...owners.emails].slice(0, 50)) : null;
  const decision = resolveUser({ ...identity, email }, linked, owner, isOwnerEmail);

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
