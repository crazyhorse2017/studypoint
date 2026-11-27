// "Unlocked until the tab closes" (AUTH-08, ARCHITECTURE A20). The unlocked data key is kept in
// sessionStorage (cleared when the tab closes) but SEALED under a non-extractable AES key stored in
// IndexedDB, so the raw key is never written anywhere readable, and a reload in the same tab doesn't re-lock.

import { fromB64u, openEnvelope, seal, toB64u } from '../../shared/crypto/vault.ts';

const DB_NAME = 'studyflare';
const STORE = 'keys';
const KEY_ID = 'session-wrap-v1';
const SESSION_ITEM = 'sf.vault.session';
const AAD = 'session:data-key';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = run(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  }));
}

async function wrappingKey(create: boolean): Promise<CryptoKey | null> {
  const existing = await idb<CryptoKey | undefined>('readonly', (s) => s.get(KEY_ID) as IDBRequest<CryptoKey | undefined>);
  if (existing) return existing;
  if (!create) return null;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await idb('readwrite', (s) => s.put(key, KEY_ID));
  return key;
}

export async function saveSession(dataKeyRaw: Uint8Array): Promise<void> {
  try {
    const key = await wrappingKey(true);
    if (!key) return;
    sessionStorage.setItem(SESSION_ITEM, toB64u(new TextEncoder().encode(await seal(key, dataKeyRaw, AAD))));
  } catch {
    // Private windows can block IndexedDB: then a reload simply asks for the passphrase again.
  }
}

export async function loadSession(): Promise<Uint8Array | null> {
  try {
    const item = sessionStorage.getItem(SESSION_ITEM);
    if (!item) return null;
    const key = await wrappingKey(false);
    if (!key) return null;
    return await openEnvelope(key, new TextDecoder().decode(fromB64u(item)), AAD);
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_ITEM);
  } catch {
    // nothing stored
  }
}
