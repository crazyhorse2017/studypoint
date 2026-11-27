// AUTH-08 / A20 vault crypto: round trips, wrong secrets, tamper detection, AAD binding, recovery codes,
// passkey wraps and the shape validation the Worker applies before storing anything.

import {
  CryptoError, MIN_ITERATIONS, createVault, decryptText, encryptText, fromB64u, generateRecoveryCode, importDataKey,
  isEnvelope, normaliseRecoveryCode, passkeyWrapProblem, randomBytes, toB64u, unlockWithPasskey, unlockWithPassphrase,
  unlockWithRecoveryCode, vaultRecordProblem, wrapForPasskey, wrapWithNewRecoveryCode, wrapWithPassphrase,
} from '../../src/shared/crypto/vault.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

// Tests use the minimum iteration count to stay fast; production uses 600k (passphrase) / 100k (recovery).
const FAST = { passIterations: MIN_ITERATIONS, recoveryIterations: MIN_ITERATIONS };

async function failsWith(p: Promise<unknown>, code: string): Promise<boolean> {
  try {
    await p;
    return false;
  } catch (e) {
    return e instanceof CryptoError && e.code === code;
  }
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

export function register(test: TestFn, assert: Assert): void {
  test('crypto: base64url round-trips every byte value and rejects junk', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    assert.ok(same(fromB64u(toB64u(all)), all));
    assert.ok(!toB64u(all).includes('=') && !toB64u(all).includes('+') && !toB64u(all).includes('/'));
    let threw = false;
    try { fromB64u('not base64!'); } catch { threw = true; }
    assert.ok(threw);
  });

  test('vault: create, then unlock with the passphrase or the recovery code gives the same data key', async () => {
    const v = await createVault('correct horse battery staple', FAST);
    assert.equal(vaultRecordProblem(v.record), null, 'the record passes the Worker shape check');
    assert.ok(/^([A-Z2-7]{4}-){5}[A-Z2-7]{4}$/.test(v.recoveryCode), v.recoveryCode);
    assert.ok(same(await unlockWithPassphrase(v.record, 'correct horse battery staple'), v.dataKeyRaw));
    assert.ok(same(await unlockWithRecoveryCode(v.record, v.recoveryCode.toLowerCase().replace(/-/g, ' ')), v.dataKeyRaw));
  });

  test('vault: a wrong passphrase or recovery code is refused (never a wrong key)', async () => {
    const v = await createVault('pass one two three', FAST);
    assert.ok(await failsWith(unlockWithPassphrase(v.record, 'pass one two four'), 'wrong_secret'));
    assert.ok(await failsWith(unlockWithRecoveryCode(v.record, generateRecoveryCode()), 'wrong_secret'));
    assert.ok(await failsWith(unlockWithRecoveryCode(v.record, 'nope'), 'wrong_secret'));
  });

  test('vault: the passphrase is NFC-normalised (é typed two ways opens the same vault)', async () => {
    const v = await createVault('café au lait', FAST);
    assert.ok(same(await unlockWithPassphrase(v.record, 'café au lait'), v.dataKeyRaw));
  });

  test('vault: changing the passphrase or recovery code keeps the same data key', async () => {
    const v = await createVault('old passphrase here', FAST);
    const record = { ...v.record, ...(await wrapWithPassphrase(v.dataKeyRaw, 'new passphrase here', MIN_ITERATIONS)) };
    assert.ok(same(await unlockWithPassphrase(record, 'new passphrase here'), v.dataKeyRaw));
    assert.ok(await failsWith(unlockWithPassphrase(record, 'old passphrase here'), 'wrong_secret'));
    const rec = await wrapWithNewRecoveryCode(v.dataKeyRaw, MIN_ITERATIONS);
    const record2 = { ...record, ...rec.fields };
    assert.ok(same(await unlockWithRecoveryCode(record2, rec.recoveryCode), v.dataKeyRaw));
    assert.ok(await failsWith(unlockWithRecoveryCode(record2, v.recoveryCode), 'wrong_secret'), 'the old recovery code stops working');
  });

  test('vault: swapping the passphrase wrap into the recovery slot is detected (AAD binding)', async () => {
    const v = await createVault('swap test passphrase', FAST);
    const tampered = { ...v.record, recoveryWrapped: v.record.passWrapped, recoverySalt: v.record.passSalt, recoveryIterations: v.record.passIterations };
    assert.ok(await failsWith(unlockWithRecoveryCode(tampered, v.recoveryCode), 'wrong_secret'));
  });

  test('vault: a wrap from a different vault is caught by the key check', async () => {
    const a = await createVault('same passphrase', FAST);
    const b = await createVault('same passphrase', FAST);
    const mixed = { ...a.record, passSalt: b.record.passSalt, passWrapped: b.record.passWrapped };
    assert.ok(await failsWith(unlockWithPassphrase(mixed, 'same passphrase'), 'corrupt'));
  });

  test('records: text round-trips, and a ciphertext moved to another record id refuses to open', async () => {
    const key = await importDataKey(randomBytes(32));
    const env = await encryptText(key, 'Bernoulli: p + ½ρv² + ρgh = const ✓', 'note-1');
    assert.ok(isEnvelope(env));
    assert.ok(!env.includes('Bernoulli'));
    assert.equal(await decryptText(key, env, 'note-1'), 'Bernoulli: p + ½ρv² + ρgh = const ✓');
    assert.ok(await failsWith(decryptText(key, env, 'note-2'), 'wrong_secret'));
    const other = await importDataKey(randomBytes(32));
    assert.ok(await failsWith(decryptText(other, env, 'note-1'), 'wrong_secret'));
  });

  test('records: a single flipped character is detected (GCM integrity)', async () => {
    const key = await importDataKey(randomBytes(32));
    const env = await encryptText(key, 'integrity matters', 'r1');
    const i = env.length - 5;
    const flipped = env.slice(0, i) + (env[i] === 'A' ? 'B' : 'A') + env.slice(i + 1);
    assert.ok(await failsWith(decryptText(key, flipped, 'r1'), 'wrong_secret'));
    assert.ok(await failsWith(decryptText(key, 'sf2.abc.def', 'r1'), 'bad_envelope'));
  });

  test('records: the same text encrypts differently every time (random IV)', async () => {
    const key = await importDataKey(randomBytes(32));
    assert.ok((await encryptText(key, 'x', 'r')) !== (await encryptText(key, 'x', 'r')));
  });

  test('passkeys: a PRF secret wraps the key; a different passkey or secret cannot open it', async () => {
    const v = await createVault('passkey test phrase', FAST);
    const prf = randomBytes(32);
    const wrap = await wrapForPasskey(v.dataKeyRaw, 'credential-AAAAAAAAAAAAAAAA', prf, randomBytes(32));
    assert.equal(passkeyWrapProblem(wrap), null);
    assert.ok(same(await unlockWithPasskey(v.record, wrap, prf), v.dataKeyRaw));
    assert.ok(await failsWith(unlockWithPasskey(v.record, wrap, randomBytes(32)), 'wrong_secret'));
    assert.ok(await failsWith(unlockWithPasskey(v.record, { ...wrap, credentialId: 'credential-BBBBBBBBBBBBBBBB' }, prf), 'wrong_secret'));
  });

  test('recovery codes: 24 base32 chars, look-alikes accepted, everything else refused', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()));
    assert.equal(codes.size, 50, 'no repeats');
    assert.equal(normaliseRecoveryCode('abcd efgh ijkl mnop qrst uvwx'), 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX');
    assert.equal(normaliseRecoveryCode('ABCD-EFGH-1JKL-MN0P-QRST-UVWX'), 'ABCD-EFGH-IJKL-MNOP-QRST-UVWX');
    assert.equal(normaliseRecoveryCode('ABCD-EFGH'), null);
    assert.equal(normaliseRecoveryCode('ABCD-EFGH-IJKL-MNOP-QRST-UVW9'), null);
  });

  test('validation: the Worker rejects weak or malformed vault records', async () => {
    const v = await createVault('validation phrase', FAST);
    assert.ok(vaultRecordProblem({ ...v.record, passIterations: 1000 }) !== null);
    assert.ok(vaultRecordProblem({ ...v.record, kdf: 'md5' }) !== null);
    assert.ok(vaultRecordProblem({ ...v.record, keyCheck: 'plaintext!' }) !== null);
    assert.ok(vaultRecordProblem({ ...v.record, passSalt: 'short' }) !== null);
    assert.ok(vaultRecordProblem(null) !== null);
    assert.ok(passkeyWrapProblem({ credentialId: 'x', prfSalt: toB64u(randomBytes(32)), wrapped: v.record.keyCheck }) !== null);
  });
}
