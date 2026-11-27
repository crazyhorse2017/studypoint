// Vault storage (AUTH-08, ARCHITECTURE A20). The Worker stores and returns WRAPPED keys only; it has no
// way to unwrap them and never tries. Everything sent in is shape-checked so a buggy or hostile client
// can't store something that isn't a sealed value (for example a plaintext key).

import { passkeyWrapProblem, vaultRecordProblem, type PasskeyWrap, type VaultRecord } from '../shared/crypto/vault.ts';

export class VaultError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'VaultError';
    this.status = status;
  }
}

type VaultRow = {
  kdf: 'pbkdf2-sha256'; pass_iterations: number; pass_salt: string; pass_wrapped: string;
  recovery_iterations: number; recovery_salt: string; recovery_wrapped: string; key_check: string;
};
type PasskeyRow = { credential_id: string; label: string; prf_salt: string; wrapped: string; created_at: number; last_used_at: number | null };

export type PasskeyInfo = PasskeyWrap & { label: string; createdAt: number; lastUsedAt: number | null };

const toRecord = (r: VaultRow): VaultRecord => ({
  kdf: r.kdf, passIterations: r.pass_iterations, passSalt: r.pass_salt, passWrapped: r.pass_wrapped,
  recoveryIterations: r.recovery_iterations, recoverySalt: r.recovery_salt, recoveryWrapped: r.recovery_wrapped, keyCheck: r.key_check,
});

export async function getVault(db: D1Database, userId: string): Promise<{ vault: VaultRecord | null; passkeys: PasskeyInfo[] }> {
  const row = await db.prepare('SELECT kdf, pass_iterations, pass_salt, pass_wrapped, recovery_iterations, recovery_salt, recovery_wrapped, key_check FROM vault WHERE user_id = ?').bind(userId).first<VaultRow>();
  const keys = await db.prepare('SELECT credential_id, label, prf_salt, wrapped, created_at, last_used_at FROM vault_passkeys WHERE user_id = ? ORDER BY created_at').bind(userId).all<PasskeyRow>();
  return {
    vault: row ? toRecord(row) : null,
    passkeys: keys.results.map((k) => ({ credentialId: k.credential_id, label: k.label, prfSalt: k.prf_salt, wrapped: k.wrapped, createdAt: k.created_at, lastUsedAt: k.last_used_at })),
  };
}

/** First-time vault creation. Refuses if one exists, so a stray request can't replace the key. */
export async function createVaultRow(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<void> {
  const problem = vaultRecordProblem(input);
  if (problem) throw new VaultError(400, problem);
  const r = input as VaultRecord;
  const res = await db.prepare(
    'INSERT OR IGNORE INTO vault (user_id, version, kdf, pass_iterations, pass_salt, pass_wrapped, recovery_iterations, recovery_salt, recovery_wrapped, key_check, created_at, updated_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(userId, r.kdf, r.passIterations, r.passSalt, r.passWrapped, r.recoveryIterations, r.recoverySalt, r.recoveryWrapped, r.keyCheck, now, now).run();
  if (!res.meta.changes) throw new VaultError(409, 'This account already has a passphrase. Unlock it, or use your recovery code.');
}

/**
 * Replace the passphrase wrap and/or the recovery wrap. The key check must stay the same: that proves the
 * new wraps belong to the SAME data key (the client could only build them after unlocking it).
 */
export async function updateVaultRow(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<void> {
  const current = (await getVault(db, userId)).vault;
  if (!current) throw new VaultError(404, 'Set a passphrase first.');
  if (typeof input !== 'object' || input === null) throw new VaultError(400, 'Missing vault data.');
  const patch = input as Partial<VaultRecord>;
  if (patch.keyCheck !== current.keyCheck) throw new VaultError(409, 'That change was made for a different key. Reload and try again.');
  const passFields = patch.passSalt !== undefined || patch.passWrapped !== undefined || patch.passIterations !== undefined;
  const recFields = patch.recoverySalt !== undefined || patch.recoveryWrapped !== undefined || patch.recoveryIterations !== undefined;
  if (!passFields && !recFields) throw new VaultError(400, 'Nothing to change.');
  const next: VaultRecord = {
    ...current,
    ...(passFields ? { passIterations: patch.passIterations as number, passSalt: patch.passSalt as string, passWrapped: patch.passWrapped as string } : {}),
    ...(recFields ? { recoveryIterations: patch.recoveryIterations as number, recoverySalt: patch.recoverySalt as string, recoveryWrapped: patch.recoveryWrapped as string } : {}),
  };
  const problem = vaultRecordProblem(next);
  if (problem) throw new VaultError(400, problem);
  await db.prepare(
    'UPDATE vault SET pass_iterations = ?, pass_salt = ?, pass_wrapped = ?, recovery_iterations = ?, recovery_salt = ?, recovery_wrapped = ?, updated_at = ? WHERE user_id = ?',
  ).bind(next.passIterations, next.passSalt, next.passWrapped, next.recoveryIterations, next.recoverySalt, next.recoveryWrapped, now, userId).run();
}

export const MAX_PASSKEYS = 10;

export async function addPasskey(db: D1Database, userId: string, input: unknown, now = Date.now()): Promise<void> {
  const problem = passkeyWrapProblem(input);
  if (problem) throw new VaultError(400, problem);
  const { vault, passkeys } = await getVault(db, userId);
  if (!vault) throw new VaultError(404, 'Set a passphrase first.');
  if (passkeys.length >= MAX_PASSKEYS) throw new VaultError(400, `You can add up to ${MAX_PASSKEYS} passkeys. Remove one first.`);
  const w = input as PasskeyWrap & { label?: unknown };
  const label = typeof w.label === 'string' && w.label.trim() !== '' ? w.label.trim().slice(0, 60) : 'Passkey';
  const res = await db.prepare('INSERT OR IGNORE INTO vault_passkeys (credential_id, user_id, label, prf_salt, wrapped, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(w.credentialId, userId, label, w.prfSalt, w.wrapped, now).run();
  if (!res.meta.changes) throw new VaultError(409, 'That passkey is already added.');
}

export async function removePasskey(db: D1Database, userId: string, credentialId: string): Promise<boolean> {
  const res = await db.prepare('DELETE FROM vault_passkeys WHERE credential_id = ? AND user_id = ?').bind(credentialId, userId).run();
  return (res.meta.changes ?? 0) > 0;
}

export async function markPasskeyUsed(db: D1Database, userId: string, credentialId: string, now = Date.now()): Promise<void> {
  await db.prepare('UPDATE vault_passkeys SET last_used_at = ? WHERE credential_id = ? AND user_id = ?').bind(now, credentialId, userId).run();
}
