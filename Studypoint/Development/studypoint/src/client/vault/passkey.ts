// Passkey unlock through the WebAuthn PRF extension (AUTH-08, ARCHITECTURE A20). The passkey produces a
// secret that only exists on the user's device; it wraps the data key locally. The server never sees it,
// so nothing here needs server-side WebAuthn verification.
//
// This is a SEPARATE passkey from the Cloudflare sign-in passkey: that one proves who you are to
// Cloudflare, this one unlocks your encrypted content on this device.

import { fromB64u, randomBytes, toB64u } from '../../shared/crypto/vault.ts';

type PrfResults = { enabled?: boolean; results?: { first?: ArrayBuffer } };
type ClientCaps = Record<string, boolean>;
type PkcStatic = { getClientCapabilities?: () => Promise<ClientCaps> };

export class PasskeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasskeyError';
  }
}

const buf = (b: Uint8Array): ArrayBuffer => b.slice().buffer as ArrayBuffer;

/** Best guess before trying: WebAuthn exists and, where the browser says, PRF is supported. */
export async function passkeysMaybeSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof window.PublicKeyCredential === 'undefined') return false;
  try {
    const caps = await (window.PublicKeyCredential as unknown as PkcStatic).getClientCapabilities?.();
    if (caps && 'extension:prf' in caps) return caps['extension:prf'] === true;
  } catch {
    // Older browsers: just try.
  }
  return true;
}

function prfOf(cred: Credential | null): { id: string; first: Uint8Array | null; enabled: boolean } {
  if (!cred) throw new PasskeyError('No passkey was used.');
  const pk = cred as PublicKeyCredential;
  const ext = pk.getClientExtensionResults() as { prf?: PrfResults };
  const first = ext.prf?.results?.first;
  return { id: toB64u(new Uint8Array(pk.rawId)), first: first ? new Uint8Array(first) : null, enabled: ext.prf?.enabled === true || !!first };
}

function friendly(err: unknown): PasskeyError {
  if (err instanceof PasskeyError) return err;
  const name = err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError') return new PasskeyError('The passkey request was cancelled or timed out.');
  if (name === 'InvalidStateError') return new PasskeyError('This device already has a Studyflare unlock passkey.');
  return new PasskeyError('This browser or device couldn’t use a passkey for unlocking. Use your passphrase instead.');
}

/** Ask the authenticator for the PRF secret of one or more known passkeys. */
async function evaluate(allow: ReadonlyArray<{ credentialId: string; prfSalt: string }>): Promise<{ credentialId: string; secret: Uint8Array }> {
  const evalByCredential: Record<string, { first: ArrayBuffer }> = {};
  for (const k of allow) evalByCredential[k.credentialId] = { first: buf(fromB64u(k.prfSalt)) };
  let cred: Credential | null;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: buf(randomBytes(32)),
        rpId: location.hostname,
        allowCredentials: allow.map((k) => ({ type: 'public-key' as const, id: buf(fromB64u(k.credentialId)) })),
        userVerification: 'required',
        timeout: 60_000,
        extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (err) {
    throw friendly(err);
  }
  const r = prfOf(cred);
  if (!r.first) throw new PasskeyError('That passkey can’t unlock Studyflare on this browser. Use your passphrase instead.');
  return { credentialId: r.id, secret: r.first };
}

/** Create a new unlock passkey and return its id, salt and PRF secret. */
export async function registerUnlockPasskey(accountEmail: string): Promise<{ credentialId: string; prfSalt: Uint8Array; secret: Uint8Array }> {
  const prfSalt = randomBytes(32);
  let cred: Credential | null;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        rp: { name: 'Studyflare', id: location.hostname },
        user: { id: buf(randomBytes(16)), name: accountEmail, displayName: `${accountEmail} (Studyflare unlock)` },
        challenge: buf(randomBytes(32)),
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        timeout: 60_000,
        extensions: { prf: { eval: { first: buf(prfSalt) } } } as AuthenticationExtensionsClientInputs,
      },
    });
  } catch (err) {
    throw friendly(err);
  }
  const made = prfOf(cred);
  if (!made.enabled) throw new PasskeyError('This passkey provider doesn’t support unlocking (no PRF). Your passphrase still works.');
  // Some authenticators return the secret at creation; others only on first use.
  if (made.first) return { credentialId: made.id, prfSalt, secret: made.first };
  const used = await evaluate([{ credentialId: made.id, prfSalt: toB64u(prfSalt) }]);
  return { credentialId: made.id, prfSalt, secret: used.secret };
}

export function unlockSecret(passkeys: ReadonlyArray<{ credentialId: string; prfSalt: string }>): Promise<{ credentialId: string; secret: Uint8Array }> {
  if (passkeys.length === 0) return Promise.reject(new PasskeyError('No unlock passkeys are set up yet.'));
  return evaluate(passkeys);
}
