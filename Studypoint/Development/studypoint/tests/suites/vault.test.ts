// AUTH-08 vault storage: create once, updates must keep the same key, only sealed values are stored,
// passkeys are per account, and every vault route needs sign-in.

import { MIN_ITERATIONS, createVault, randomBytes, wrapForPasskey, wrapWithPassphrase, type VaultRecord } from '../../src/shared/crypto/vault.ts';
import { VaultError, addPasskey, createVaultRow, getVault, removePasskey, updateVaultRow } from '../../src/worker/vault.ts';
import { ROUTES, createApp, type Env } from '../../src/worker/app.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

type Row = Record<string, unknown>;

/** In-memory stand-in for exactly the vault SQL in src/worker/vault.ts. Unknown SQL throws. */
function fakeDb() {
  const vaults = new Map<string, Row>();
  const keys = new Map<string, Row>();
  const stmt = (sql: string, a: unknown[] = []) => ({
    bind: (...args: unknown[]) => stmt(sql, args),
    async first() {
      if (sql.startsWith('SELECT kdf, pass_iterations')) return vaults.get(a[0] as string) ?? null;
      throw new Error('unexpected first: ' + sql);
    },
    async all() {
      if (sql.startsWith('SELECT credential_id, label')) return { results: [...keys.values()].filter((k) => k['user_id'] === a[0]) };
      throw new Error('unexpected all: ' + sql);
    },
    async run() {
      if (sql.startsWith('INSERT OR IGNORE INTO vault (')) {
        if (vaults.has(a[0] as string)) return { meta: { changes: 0 } };
        vaults.set(a[0] as string, { kdf: a[1], pass_iterations: a[2], pass_salt: a[3], pass_wrapped: a[4], recovery_iterations: a[5], recovery_salt: a[6], recovery_wrapped: a[7], key_check: a[8] });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith('UPDATE vault SET')) {
        const v = vaults.get(a[7] as string);
        if (v) Object.assign(v, { pass_iterations: a[0], pass_salt: a[1], pass_wrapped: a[2], recovery_iterations: a[3], recovery_salt: a[4], recovery_wrapped: a[5] });
        return { meta: { changes: v ? 1 : 0 } };
      }
      if (sql.startsWith('INSERT OR IGNORE INTO vault_passkeys')) {
        if (keys.has(a[0] as string)) return { meta: { changes: 0 } };
        keys.set(a[0] as string, { credential_id: a[0], user_id: a[1], label: a[2], prf_salt: a[3], wrapped: a[4], created_at: a[5], last_used_at: null });
        return { meta: { changes: 1 } };
      }
      if (sql.startsWith('DELETE FROM vault_passkeys')) {
        const k = keys.get(a[0] as string);
        if (!k || k['user_id'] !== a[1]) return { meta: { changes: 0 } };
        keys.delete(a[0] as string);
        return { meta: { changes: 1 } };
      }
      throw new Error('unexpected run: ' + sql);
    },
  });
  return { db: { prepare: (sql: string) => stmt(sql) } as unknown as D1Database, vaults };
}

const FAST = { passIterations: MIN_ITERATIONS, recoveryIterations: MIN_ITERATIONS };

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 0;
  } catch (e) {
    return e instanceof VaultError ? e.status : -1;
  }
}

export function register(test: TestFn, assert: Assert): void {
  test('vault store: created once; a second create is refused (409) and nothing is replaced', async () => {
    const { db } = fakeDb();
    const v1 = await createVault('first passphrase', FAST);
    await createVaultRow(db, 'u1', v1.record);
    assert.deepEqual((await getVault(db, 'u1')).vault, v1.record);
    const v2 = await createVault('second passphrase', FAST);
    assert.equal(await status(createVaultRow(db, 'u1', v2.record)), 409);
    assert.deepEqual((await getVault(db, 'u1')).vault, v1.record, 'original kept');
    assert.equal((await getVault(db, 'u2')).vault, null, 'other accounts have their own (none yet)');
  });

  test('vault store: plaintext or weak values are never stored', async () => {
    const { db, vaults } = fakeDb();
    const v = await createVault('shape check phrase', FAST);
    const raw = btoa(String.fromCharCode(...v.dataKeyRaw));
    assert.equal(await status(createVaultRow(db, 'u1', { ...v.record, passWrapped: raw })), 400);
    assert.equal(await status(createVaultRow(db, 'u1', { ...v.record, passIterations: 10 })), 400);
    assert.equal(vaults.size, 0);
  });

  test('vault store: a passphrase change must carry the same key check (same data key)', async () => {
    const { db } = fakeDb();
    const v = await createVault('original phrase', FAST);
    await createVaultRow(db, 'u1', v.record);
    const newPass = await wrapWithPassphrase(v.dataKeyRaw, 'changed phrase', MIN_ITERATIONS);
    await updateVaultRow(db, 'u1', { ...newPass, keyCheck: v.record.keyCheck });
    const stored = (await getVault(db, 'u1')).vault as VaultRecord;
    assert.equal(stored.passWrapped, newPass.passWrapped);
    assert.equal(stored.recoveryWrapped, v.record.recoveryWrapped, 'recovery wrap untouched');
    const other = await createVault('someone else', FAST);
    assert.equal(await status(updateVaultRow(db, 'u1', { ...newPass, keyCheck: other.record.keyCheck })), 409);
    assert.equal(await status(updateVaultRow(db, 'u2', { ...newPass, keyCheck: v.record.keyCheck })), 404);
  });

  test('vault store: passkeys are per account, labelled, de-duplicated and removable only by their owner', async () => {
    const { db } = fakeDb();
    const v = await createVault('passkey owner phrase', FAST);
    await createVaultRow(db, 'u1', v.record);
    const wrap = await wrapForPasskey(v.dataKeyRaw, 'cred-AAAAAAAAAAAAAAAAAAAA', randomBytes(32), randomBytes(32));
    await addPasskey(db, 'u1', { ...wrap, label: '  Windows Hello  ' });
    assert.equal(await status(addPasskey(db, 'u1', wrap)), 409);
    assert.equal(await status(addPasskey(db, 'u2', wrap)), 404, 'no vault, no passkeys');
    const list = (await getVault(db, 'u1')).passkeys;
    assert.equal(list.length, 1);
    assert.equal(list[0]?.label, 'Windows Hello');
    assert.ok(!(await removePasskey(db, 'u2', wrap.credentialId)), "another account can't remove it");
    assert.ok(await removePasskey(db, 'u1', wrap.credentialId));
    assert.equal((await getVault(db, 'u1')).passkeys.length, 0);
  });

  test('vault routes: registered and every one requires sign-in', async () => {
    const paths = ROUTES.filter((r) => r.path.startsWith('/api/vault')).map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(paths.sort(), [
      'DELETE /api/vault/passkeys/:id', 'GET /api/vault', 'PATCH /api/vault', 'POST /api/vault/passkeys', 'POST /api/vault/passkeys/:id/used', 'PUT /api/vault',
    ]);
    const app = createApp({ makeVerifier: () => async () => { throw new Error('no'); } });
    const env = { ASSETS: {} as Fetcher, ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAILS: 'me@example.com' } as Env;
    const res = await app.fetch(new Request('https://x.test/api/vault', { method: 'PUT', body: '{}' }), env);
    assert.equal(res.status, 401);
  });
}
