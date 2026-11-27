// Settings → Security (AUTH-08): lock now, unlock passkeys, change passphrase, new recovery code.

import { useEffect, useState } from 'react';
import { Button, ConfirmDialog, TextField, useToast } from '../ds/index.ts';
import { passkeysMaybeSupported } from '../vault/passkey.ts';
import {
  addUnlockPasskey, changePassphrase, lock, passphraseProblem, removeUnlockPasskey, replaceRecoveryCode, useVault,
} from '../vault/vaultStore.ts';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');
const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export function SecuritySection({ email }: { email: string | null }) {
  const toast = useToast();
  const { passkeys } = useVault();
  const [supported, setSupported] = useState(false);
  const [label, setLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [passError, setPassError] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [confirmNewCode, setConfirmNewCode] = useState(false);

  useEffect(() => {
    void passkeysMaybeSupported().then(setSupported);
  }, []);

  const addPasskey = async () => {
    setAdding(true);
    try {
      await addUnlockPasskey(email ?? 'Studyflare user', label.trim() || 'Passkey');
      setLabel('');
      toast.show({ message: 'Passkey added. You can unlock with it next time.' });
    } catch (e) {
      toast.show({ message: message(e), tone: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const submitPassphrase = async () => {
    setPassError(null);
    const problem = passphraseProblem(n1);
    if (problem) return setPassError(problem);
    if (n1.trim() !== n2.trim()) return setPassError('The two passphrases don’t match.');
    setChanging(true);
    try {
      await changePassphrase(n1);
      setN1('');
      setN2('');
      toast.show({ message: 'Passphrase changed. Use the new one from now on.' });
    } catch (e) {
      setPassError(message(e));
    } finally {
      setChanging(false);
    }
  };

  return (
    <section aria-labelledby="security-heading" className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 id="security-heading" className="text-xl font-semibold">
          Security
        </h2>
        <p className="text-sm text-text-2">
          Your study material is encrypted on this device. Studyflare locks when you close the tab or after 30 minutes without use.
        </p>
      </div>

      <div>
        <Button onClick={lock}>Lock now</Button>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">Unlock passkeys</h3>
        <p className="text-sm text-text-2">
          Unlock with your fingerprint, face or device PIN instead of typing your passphrase. This is separate from the passkey you use to sign in.
        </p>
        {passkeys.length > 0 ? (
          <ul className="rounded-lg border border-border bg-surface px-4">
            {passkeys.map((k) => (
              <li key={k.credentialId} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-text">{k.label}</span>
                  <span className="text-sm text-text-3">
                    Added {day(k.createdAt)}
                    {k.lastUsedAt ? ` · last used ${day(k.lastUsedAt)}` : ''}
                  </span>
                </span>
                <Button size="sm" variant="danger" onClick={() => setRemoving(k.credentialId)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        {supported ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void addPasskey();
            }}
          >
            <div className="min-w-64 flex-1">
              <TextField label="Name for this passkey" placeholder="e.g. Laptop fingerprint" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <Button type="submit" loading={adding}>
              Add passkey
            </Button>
          </form>
        ) : (
          <p className="text-sm text-text-2">This browser can’t unlock with a passkey. Your passphrase works everywhere.</p>
        )}
      </div>

      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submitPassphrase();
        }}
      >
        <h3 className="font-semibold">Change passphrase</h3>
        <TextField label="New passphrase" type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} />
        <TextField label="Type it again" type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} error={passError} />
        <div>
          <Button type="submit" loading={changing}>
            Change passphrase
          </Button>
        </div>
      </form>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold">Recovery code</h3>
        <p className="text-sm text-text-2">Lost your recovery code? Make a new one. The old code stops working right away.</p>
        <div>
          <Button onClick={() => setConfirmNewCode(true)}>Make a new recovery code</Button>
        </div>
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this passkey?"
        message="It won’t be able to unlock Studyflare any more. Your passphrase and other passkeys still work."
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const id = removing;
          setRemoving(null);
          if (id) void removeUnlockPasskey(id).catch((e) => toast.show({ message: message(e), tone: 'error' }));
        }}
      />
      <ConfirmDialog
        open={confirmNewCode}
        title="Make a new recovery code?"
        message="Your current recovery code will stop working. You’ll see the new one once, so have somewhere ready to save it."
        confirmLabel="Make new code"
        onCancel={() => setConfirmNewCode(false)}
        onConfirm={() => {
          setConfirmNewCode(false);
          void replaceRecoveryCode().catch((e) => toast.show({ message: message(e), tone: 'error' }));
        }}
      />
    </section>
  );
}
