// End-to-end encryption primitives (AUTH-08, ARCHITECTURE A19/A20). Pure WebCrypto: the same code runs
// in the browser (the only place keys are ever unwrapped) and in local tests. The server never calls
// the unlock functions; it only stores what `createVault` and friends produce.
//
// Envelope format: "sf1.<iv>.<ciphertext>" (base64url, AES-256-GCM, 96-bit random IV). The associated
// data (AAD) binds a ciphertext to where it belongs (a record id, or which wrap it is), so a ciphertext
// copied into another row or slot fails to open.

export const PASS_ITERATIONS = 600_000;
export const RECOVERY_ITERATIONS = 100_000;
export const MIN_ITERATIONS = 100_000;
const KEY_CHECK_TEXT = 'studyflare-key-check-v1';
const PREFIX = 'sf1';

export class CryptoError extends Error {
  readonly code: 'wrong_secret' | 'bad_envelope' | 'corrupt';
  constructor(code: 'wrong_secret' | 'bad_envelope' | 'corrupt', message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}

// ---------- encoding ----------

export function toB64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(text: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new CryptoError('bad_envelope', 'Not base64url.');
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

const utf8 = new TextEncoder();
const fromUtf8 = new TextDecoder('utf-8', { fatal: true });

/** WebCrypto wants an ArrayBuffer-backed view; copying also detaches us from caller buffers. */
function buf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

// ---------- keys ----------

/** A wrapping key from a passphrase or recovery code (PBKDF2-SHA256 → AES-GCM-256, non-extractable). */
export async function deriveWrappingKey(secret: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS) throw new CryptoError('corrupt', 'Iteration count is too low.');
  const base = await crypto.subtle.importKey('raw', buf(utf8.encode(secret.normalize('NFC'))), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** A wrapping key from a passkey's WebAuthn PRF output (HKDF-SHA256 → AES-GCM-256). */
export async function keyFromPrf(prfOutput: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
  if (prfOutput.length < 32) throw new CryptoError('corrupt', 'Passkey secret is too short.');
  const base = await crypto.subtle.importKey('raw', buf(prfOutput), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(salt), info: buf(utf8.encode('studyflare-passkey-unlock-v1')) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** The data key as a usable AES key. Non-extractable unless a caller must re-wrap it. */
export function importDataKey(raw: Uint8Array, extractable = false): Promise<CryptoKey> {
  if (raw.length !== 32) throw new CryptoError('corrupt', 'Data key must be 32 bytes.');
  return crypto.subtle.importKey('raw', buf(raw), { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

// ---------- envelopes ----------

export async function seal(key: CryptoKey, plaintext: Uint8Array, aad: string): Promise<string> {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8.encode(aad)) }, key, buf(plaintext));
  return `${PREFIX}.${toB64u(iv)}.${toB64u(new Uint8Array(ct))}`;
}

export function isEnvelope(text: unknown): boolean {
  return typeof text === 'string' && /^sf1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/.test(text);
}

export async function openEnvelope(key: CryptoKey, envelope: string, aad: string): Promise<Uint8Array> {
  const parts = envelope.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX || !parts[1] || !parts[2]) throw new CryptoError('bad_envelope', 'Not a Studyflare ciphertext.');
  const iv = fromB64u(parts[1]);
  if (iv.length !== 12) throw new CryptoError('bad_envelope', 'Bad IV.');
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: buf(utf8.encode(aad)) }, key, buf(fromB64u(parts[2])));
    return new Uint8Array(pt);
  } catch {
    throw new CryptoError('wrong_secret', 'That key does not open this data.');
  }
}

/** Encrypt text that belongs to one record; `recordId` must be the row's id (it becomes the AAD). */
export async function encryptText(dataKey: CryptoKey, text: string, recordId: string): Promise<string> {
  return seal(dataKey, utf8.encode(text), `rec:${recordId}`);
}

export async function decryptText(dataKey: CryptoKey, envelope: string, recordId: string): Promise<string> {
  const bytes = await openEnvelope(dataKey, envelope, `rec:${recordId}`);
  try {
    return fromUtf8.decode(bytes);
  } catch {
    throw new CryptoError('corrupt', 'Decrypted data is not text.');
  }
}

// ---------- recovery codes ----------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** 120 random bits as 24 base32 characters, shown as 6 groups of 4: "ABCD-EFGH-…". */
export function generateRecoveryCode(): string {
  const bytes = randomBytes(15);
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return (out.match(/.{4}/g) ?? []).join('-');
}

/** Accepts any spacing, dashes or case, and the usual look-alikes (0→O, 1→I, 8→B). Null if invalid. */
export function normaliseRecoveryCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, '').replace(/0/g, 'O').replace(/1/g, 'I').replace(/8/g, 'B');
  if (!/^[A-Z2-7]{24}$/.test(s)) return null;
  return (s.match(/.{4}/g) ?? []).join('-');
}

// ---------- the vault record ----------

/** What the server stores (all strings are base64url or sf1 envelopes; nothing here can unlock alone). */
export type VaultRecord = {
  kdf: 'pbkdf2-sha256';
  passIterations: number;
  passSalt: string;
  passWrapped: string;
  recoveryIterations: number;
  recoverySalt: string;
  recoveryWrapped: string;
  keyCheck: string;
};

export type PasskeyWrap = { credentialId: string; prfSalt: string; wrapped: string };

export type NewVault = { record: VaultRecord; dataKeyRaw: Uint8Array; recoveryCode: string };

const AAD_PASS = 'vault:pass';
const AAD_RECOVERY = 'vault:recovery';
const AAD_CHECK = 'vault:key-check';
const aadPasskey = (credentialId: string) => `vault:passkey:${credentialId}`;

export type VaultOptions = { passIterations?: number; recoveryIterations?: number };

export async function wrapWithPassphrase(dataKeyRaw: Uint8Array, passphrase: string, iterations = PASS_ITERATIONS) {
  const salt = randomBytes(16);
  const kek = await deriveWrappingKey(passphrase, salt, iterations);
  return { passIterations: iterations, passSalt: toB64u(salt), passWrapped: await seal(kek, dataKeyRaw, AAD_PASS) };
}

export async function wrapWithNewRecoveryCode(dataKeyRaw: Uint8Array, iterations = RECOVERY_ITERATIONS) {
  const recoveryCode = generateRecoveryCode();
  const salt = randomBytes(16);
  const kek = await deriveWrappingKey(recoveryCode, salt, iterations);
  return {
    recoveryCode,
    fields: { recoveryIterations: iterations, recoverySalt: toB64u(salt), recoveryWrapped: await seal(kek, dataKeyRaw, AAD_RECOVERY) },
  };
}

export async function createVault(passphrase: string, opts: VaultOptions = {}): Promise<NewVault> {
  const dataKeyRaw = randomBytes(32);
  const pass = await wrapWithPassphrase(dataKeyRaw, passphrase, opts.passIterations ?? PASS_ITERATIONS);
  const rec = await wrapWithNewRecoveryCode(dataKeyRaw, opts.recoveryIterations ?? RECOVERY_ITERATIONS);
  const keyCheck = await seal(await importDataKey(dataKeyRaw), utf8.encode(KEY_CHECK_TEXT), AAD_CHECK);
  return { record: { kdf: 'pbkdf2-sha256', ...pass, ...rec.fields, keyCheck }, dataKeyRaw, recoveryCode: rec.recoveryCode };
}

/** Confirms an unwrapped key is the vault's real data key (guards against a corrupted or swapped wrap). */
export async function checkDataKey(record: VaultRecord, raw: Uint8Array): Promise<Uint8Array> {
  if (raw.length !== 32) throw new CryptoError('corrupt', 'Unwrapped key has the wrong size.');
  const check = await openEnvelope(await importDataKey(raw), record.keyCheck, AAD_CHECK).catch(() => null);
  if (!check || fromUtf8.decode(check) !== KEY_CHECK_TEXT) throw new CryptoError('corrupt', 'The vault key check failed.');
  return raw;
}

export async function unlockWithPassphrase(record: VaultRecord, passphrase: string): Promise<Uint8Array> {
  const kek = await deriveWrappingKey(passphrase, fromB64u(record.passSalt), record.passIterations);
  return checkDataKey(record, await openEnvelope(kek, record.passWrapped, AAD_PASS));
}

export async function unlockWithRecoveryCode(record: VaultRecord, code: string): Promise<Uint8Array> {
  const normalised = normaliseRecoveryCode(code);
  if (!normalised) throw new CryptoError('wrong_secret', 'That isn’t a recovery code.');
  const kek = await deriveWrappingKey(normalised, fromB64u(record.recoverySalt), record.recoveryIterations);
  return checkDataKey(record, await openEnvelope(kek, record.recoveryWrapped, AAD_RECOVERY));
}

export async function wrapForPasskey(dataKeyRaw: Uint8Array, credentialId: string, prfOutput: Uint8Array, prfSalt: Uint8Array): Promise<PasskeyWrap> {
  const kek = await keyFromPrf(prfOutput, prfSalt);
  return { credentialId, prfSalt: toB64u(prfSalt), wrapped: await seal(kek, dataKeyRaw, aadPasskey(credentialId)) };
}

export async function unlockWithPasskey(record: VaultRecord, wrap: PasskeyWrap, prfOutput: Uint8Array): Promise<Uint8Array> {
  const kek = await keyFromPrf(prfOutput, fromB64u(wrap.prfSalt));
  return checkDataKey(record, await openEnvelope(kek, wrap.wrapped, aadPasskey(wrap.credentialId)));
}

// ---------- validation (used by the Worker before storing) ----------

const B64U_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Shape check for a vault record sent by a client. Returns an error message, or null when valid. */
export function vaultRecordProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'Missing vault data.';
  const r = input as Record<string, unknown>;
  if (r['kdf'] !== 'pbkdf2-sha256') return 'Unsupported key derivation.';
  for (const k of ['passIterations', 'recoveryIterations']) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_ITERATIONS || v > 10_000_000) return `${k} is out of range.`;
  }
  for (const k of ['passSalt', 'recoverySalt']) if (typeof r[k] !== 'string' || !B64U_RE.test(r[k] as string)) return `${k} is invalid.`;
  for (const k of ['passWrapped', 'recoveryWrapped', 'keyCheck']) if (!isEnvelope(r[k])) return `${k} is not a sealed value.`;
  return null;
}

export function passkeyWrapProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'Missing passkey data.';
  const r = input as Record<string, unknown>;
  if (typeof r['credentialId'] !== 'string' || !/^[A-Za-z0-9_-]{16,1400}$/.test(r['credentialId'] as string)) return 'Invalid passkey id.';
  if (typeof r['prfSalt'] !== 'string' || !B64U_RE.test(r['prfSalt'] as string)) return 'Invalid passkey salt.';
  if (!isEnvelope(r['wrapped'])) return 'Passkey key is not a sealed value.';
  return null;
}
