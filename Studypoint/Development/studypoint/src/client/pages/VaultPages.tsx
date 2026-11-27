// The lock screens (AUTH-08): create a passphrase, save the recovery code, unlock (passphrase, passkey or
// recovery code). Nothing behind the gate renders until the vault is unlocked.

import { useEffect, useState, type ReactNode } from 'react';
import { Button, Checkbox, TextField, useToast } from '../ds/index.ts';
import {
  confirmRecoverySaved, createPassphrase, initVault, passphraseProblem, recoverAndReset, unlockPassphrase, unlockPasskey, useVault,
} from '../vault/vaultStore.ts';

const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

function LockLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-3">
        <img src="/brand/logo.svg" alt="" width={40} height={40} />
        <span className="text-xl font-semibold">Studyflare</span>
      </div>
      <h1 className="text-3xl font-semibold">{title}</h1>
      {children}
    </main>
  );
}

const LOSS_WARNING = 'If you lose both your passphrase and your recovery code, your notes and files can’t be recovered by anyone. That’s what end-to-end encryption means.';

function CreatePassphrase() {
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const problem = passphraseProblem(p1);
    if (problem) return setError(problem);
    if (p1.trim() !== p2.trim()) return setError('The two passphrases don’t match.');
    setBusy(true);
    try {
      await createPassphrase(p1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <LockLayout title="Create your passphrase">
      <p className="text-text-2">
        Studyflare encrypts your notes, files and cards on this device before they’re saved, so Cloudflare only ever stores
        scrambled data. Your passphrase is the key. It never leaves this device.
      </p>
      <p role="note" className="rounded-lg border border-border-strong bg-sunken p-3 text-sm text-text">
        <strong>Warning:</strong> {LOSS_WARNING}
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <TextField label="Passphrase" type="password" autoComplete="new-password" description="At least 12 characters. Four or more random words are easy to remember and hard to guess." value={p1} onChange={(e) => setP1(e.target.value)} required />
        <TextField label="Type it again" type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} error={error} required />
        <div>
          <Button type="submit" variant="primary" loading={busy}>
            Create passphrase
          </Button>
        </div>
      </form>
    </LockLayout>
  );
}

export function RecoveryCodeScreen({ code }: { code: string }) {
  const toast = useToast();
  const [saved, setSaved] = useState(false);

  const download = () => {
    const blob = new Blob([`Studyflare recovery code\n\n${code}\n\nKeep this somewhere safe. It unlocks your encrypted notes if you forget your passphrase.\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'studyflare-recovery-code.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <LockLayout title="Save your recovery code">
      <p className="text-text-2">
        This code unlocks Studyflare if you ever forget your passphrase. It’s shown only now. Write it down or save it in a password manager.
      </p>
      <p className="select-all rounded-lg border border-border bg-surface p-4 text-center font-mono text-xl tracking-wider text-text" aria-label={`Recovery code: ${code.split('').join(' ')}`}>
        {code}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            void navigator.clipboard.writeText(code).then(
              () => toast.show({ message: 'Recovery code copied' }),
              () => toast.show({ message: 'Couldn’t copy. Select the code and copy it by hand.', tone: 'error' }),
            );
          }}
        >
          Copy
        </Button>
        <Button onClick={download}>Download as a text file</Button>
      </div>
      <p className="text-sm text-text-2">{LOSS_WARNING}</p>
      <Checkbox checked={saved} onChange={setSaved} label="I’ve saved my recovery code somewhere safe" />
      <div>
        <Button variant="primary" disabled={!saved} onClick={confirmRecoverySaved}>
          Continue to Studyflare
        </Button>
      </div>
    </LockLayout>
  );
}

function Unlock({ hasPasskeys }: { hasPasskeys: boolean }) {
  const [mode, setMode] = useState<'passphrase' | 'recovery'>('passphrase');
  const [pass, setPass] = useState('');
  const [code, setCode] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  if (mode === 'recovery') {
    return (
      <LockLayout title="Unlock with your recovery code">
        <p className="text-text-2">Enter the recovery code you saved, then choose a new passphrase.</p>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (n1.trim() !== n2.trim()) return setError('The two new passphrases don’t match.');
            void run(() => recoverAndReset(code, n1));
          }}
        >
          <TextField label="Recovery code" autoComplete="off" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" value={code} onChange={(e) => setCode(e.target.value)} required />
          <TextField label="New passphrase" type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} required />
          <TextField label="Type the new passphrase again" type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} error={error} required />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" loading={busy}>
              Unlock and set passphrase
            </Button>
            <Button variant="ghost" onClick={() => { setMode('passphrase'); setError(null); }}>
              Back
            </Button>
          </div>
        </form>
      </LockLayout>
    );
  }

  return (
    <LockLayout title="Studyflare is locked">
      <p className="text-text-2">Enter your passphrase to decrypt your study material on this device.</p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => unlockPassphrase(pass));
        }}
      >
        <TextField label="Passphrase" type="password" autoComplete="current-password" value={pass} onChange={(e) => setPass(e.target.value)} error={error} required autoFocus />
        <Button type="submit" variant="primary" loading={busy}>
          Unlock
        </Button>
        {hasPasskeys ? (
          <Button onClick={() => void run(unlockPasskey)} disabled={busy}>
            Unlock with passkey
          </Button>
        ) : null}
      </form>
      <div>
        <Button variant="ghost" size="sm" onClick={() => { setMode('recovery'); setError(null); }}>
          Forgot passphrase? Use your recovery code
        </Button>
      </div>
    </LockLayout>
  );
}

/** Renders the app only once the vault is unlocked (and any new recovery code has been confirmed). */
export function VaultGate({ children }: { children: ReactNode }) {
  const v = useVault();
  useEffect(() => {
    void initVault();
  }, []);

  if (v.status === 'loading') return null;
  if (v.status === 'error') {
    return (
      <LockLayout title="Studyflare couldn’t load">
        <p className="text-text-2">{v.error}</p>
        <div>
          <Button variant="primary" onClick={() => void initVault()}>
            Try again
          </Button>
        </div>
      </LockLayout>
    );
  }
  if (v.status === 'none') return <CreatePassphrase />;
  if (v.status === 'locked') return <Unlock hasPasskeys={v.passkeys.length > 0} />;
  if (v.pendingRecoveryCode) return <RecoveryCodeScreen code={v.pendingRecoveryCode} />;
  return <>{children}</>;
}
