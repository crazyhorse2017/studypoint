// The lock (AUTH-08): loading → none (no passphrase yet) | locked | unlocked. The unlocked data key lives
// only in this module (memory) and, sealed, in this tab's session (sessionKey.ts). It locks when the tab
// closes, after 30 minutes idle, or on "Lock now".

import { useSyncExternalStore } from 'react';
import { api } from '../api.ts';
import {
  CryptoError, checkDataKey, createVault, importDataKey, unlockWithPasskey, unlockWithPassphrase, unlockWithRecoveryCode,
  wrapForPasskey, wrapWithNewRecoveryCode, wrapWithPassphrase, type PasskeyWrap, type VaultRecord,
} from '../../shared/crypto/vault.ts';
import { clearSession, loadSession, saveSession } from './sessionKey.ts';
import { registerUnlockPasskey, unlockSecret } from './passkey.ts';

export type PasskeyInfo = PasskeyWrap & { label: string; createdAt: number; lastUsedAt: number | null };
type VaultResponse = { vault: VaultRecord | null; passkeys: PasskeyInfo[] };

export type VaultStatus = 'loading' | 'error' | 'none' | 'locked' | 'unlocked';
export type VaultState = {
  status: VaultStatus;
  error: string | null;
  record: VaultRecord | null;
  passkeys: PasskeyInfo[];
  /** Shown once right after creating the vault (or a new code); the app stays behind it until confirmed. */
  pendingRecoveryCode: string | null;
};

export const IDLE_LOCK_MS = 30 * 60 * 1000;
export const MIN_PASSPHRASE_LENGTH = 12;

let state: VaultState = { status: 'loading', error: null, record: null, passkeys: [], pendingRecoveryCode: null };
let dataKeyRaw: Uint8Array | null = null;
let dataKey: CryptoKey | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<VaultState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

type Unsubscribe = () => void;

function subscribe(l: () => void): Unsubscribe {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useVault(): VaultState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** The unlocked data key for encrypting and decrypting content, or null while locked. */
export function currentDataKey(): CryptoKey | null {
  return dataKey;
}

/** Plain-language check used on the create and change screens. Null when acceptable. */
export function passphraseProblem(p: string): string | null {
  const t = p.trim();
  if (t.length < MIN_PASSPHRASE_LENGTH) return `Use at least ${MIN_PASSPHRASE_LENGTH} characters. Four or more random words work well.`;
  if (new Set(t.toLowerCase()).size < 5) return 'That’s too repetitive. Mix in more different characters or words.';
  return null;
}

// ---------- idle lock ----------

let idleTimer: ReturnType<typeof setTimeout> | null = null;
const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

function bumpIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lock(), IDLE_LOCK_MS);
}

function startIdleWatch(): void {
  for (const e of ACTIVITY) window.addEventListener(e, bumpIdle, { passive: true });
  bumpIdle();
}

function stopIdleWatch(): void {
  for (const e of ACTIVITY) window.removeEventListener(e, bumpIdle);
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

// ---------- transitions ----------

async function becomeUnlocked(raw: Uint8Array, patch: Partial<VaultState> = {}): Promise<void> {
  dataKeyRaw = raw;
  dataKey = await importDataKey(raw);
  await saveSession(raw);
  startIdleWatch();
  set({ status: 'unlocked', error: null, ...patch });
}

export function lock(): void {
  if (dataKeyRaw) dataKeyRaw.fill(0);
  dataKeyRaw = null;
  dataKey = null;
  clearSession();
  stopIdleWatch();
  if (state.record) set({ status: 'locked', pendingRecoveryCode: null });
}

export async function initVault(): Promise<void> {
  set({ status: 'loading', error: null });
  let res: VaultResponse;
  try {
    res = await api<VaultResponse>('GET', '/api/vault');
  } catch (e) {
    set({ status: 'error', error: e instanceof Error ? e.message : 'Studyflare couldn’t load your lock settings.' });
    return;
  }
  if (!res.vault) {
    set({ status: 'none', record: null, passkeys: [] });
    return;
  }
  set({ record: res.vault, passkeys: res.passkeys });
  const saved = await loadSession();
  if (saved) {
    try {
      await becomeUnlocked(await checkDataKey(res.vault, saved));
      return;
    } catch {
      clearSession();
    }
  }
  set({ status: 'locked' });
}

function applyServer(res: VaultResponse): void {
  set({ record: res.vault, passkeys: res.passkeys });
}

const wrong = (e: unknown, fallback: string) => (e instanceof CryptoError && e.code === 'wrong_secret' ? fallback : e instanceof Error ? e.message : fallback);

export async function createPassphrase(passphrase: string): Promise<void> {
  const problem = passphraseProblem(passphrase);
  if (problem) throw new Error(problem);
  const v = await createVault(passphrase.trim());
  applyServer(await api<VaultResponse>('PUT', '/api/vault', v.record));
  await becomeUnlocked(v.dataKeyRaw, { pendingRecoveryCode: v.recoveryCode });
}

export function confirmRecoverySaved(): void {
  set({ pendingRecoveryCode: null });
}

export async function unlockPassphrase(passphrase: string): Promise<void> {
  if (!state.record) throw new Error('Nothing to unlock yet.');
  try {
    await becomeUnlocked(await unlockWithPassphrase(state.record, passphrase.trim()));
  } catch (e) {
    throw new Error(wrong(e, 'That passphrase didn’t unlock Studyflare. Check for typos and try again.'));
  }
}

/** Forgot the passphrase: unlock with the recovery code, then set a new passphrase right away. */
export async function recoverAndReset(code: string, newPassphrase: string): Promise<void> {
  if (!state.record) throw new Error('Nothing to unlock yet.');
  const problem = passphraseProblem(newPassphrase);
  if (problem) throw new Error(problem);
  let raw: Uint8Array;
  try {
    raw = await unlockWithRecoveryCode(state.record, code);
  } catch (e) {
    throw new Error(wrong(e, 'That recovery code didn’t match. Check it and try again.'));
  }
  const pass = await wrapWithPassphrase(raw, newPassphrase.trim());
  applyServer(await api<VaultResponse>('PATCH', '/api/vault', { ...pass, keyCheck: state.record.keyCheck }));
  await becomeUnlocked(raw);
}

export async function unlockPasskey(): Promise<void> {
  if (!state.record) throw new Error('Nothing to unlock yet.');
  const { credentialId, secret } = await unlockSecret(state.passkeys);
  const wrap = state.passkeys.find((k) => k.credentialId === credentialId);
  if (!wrap) throw new Error('That passkey isn’t set up to unlock this account.');
  try {
    await becomeUnlocked(await unlockWithPasskey(state.record, wrap, secret));
  } catch (e) {
    throw new Error(wrong(e, 'That passkey couldn’t unlock Studyflare. Use your passphrase instead.'));
  }
  void api('POST', `/api/vault/passkeys/${encodeURIComponent(credentialId)}/used`).catch(() => undefined);
}

function requireUnlocked(): { raw: Uint8Array; record: VaultRecord } {
  if (!dataKeyRaw || !state.record) throw new Error('Unlock Studyflare first.');
  return { raw: dataKeyRaw, record: state.record };
}

export async function changePassphrase(newPassphrase: string): Promise<void> {
  const problem = passphraseProblem(newPassphrase);
  if (problem) throw new Error(problem);
  const { raw, record } = requireUnlocked();
  const pass = await wrapWithPassphrase(raw, newPassphrase.trim());
  applyServer(await api<VaultResponse>('PATCH', '/api/vault', { ...pass, keyCheck: record.keyCheck }));
}

/** Replaces the recovery code. The old code stops working; the new one is shown once. */
export async function replaceRecoveryCode(): Promise<void> {
  const { raw, record } = requireUnlocked();
  const rec = await wrapWithNewRecoveryCode(raw);
  applyServer(await api<VaultResponse>('PATCH', '/api/vault', { ...rec.fields, keyCheck: record.keyCheck }));
  set({ pendingRecoveryCode: rec.recoveryCode });
}

export async function addUnlockPasskey(accountEmail: string, label: string): Promise<void> {
  const { raw } = requireUnlocked();
  const made = await registerUnlockPasskey(accountEmail);
  const wrap = await wrapForPasskey(raw, made.credentialId, made.secret, made.prfSalt);
  applyServer(await api<VaultResponse>('POST', '/api/vault/passkeys', { ...wrap, label }));
}

export async function removeUnlockPasskey(credentialId: string): Promise<void> {
  applyServer(await api<VaultResponse>('DELETE', `/api/vault/passkeys/${encodeURIComponent(credentialId)}`));
}
