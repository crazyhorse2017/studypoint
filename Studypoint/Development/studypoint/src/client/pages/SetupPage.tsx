// First-run setup (AUTH-07). Shown only on a fresh one-click deploy, before any sign-in exists.
// The deployer pastes a one-time Cloudflare API token; the Worker creates the Access login for the
// emails they typed in ALLOWED_EMAILS. The token is sent once and never stored.

import { useState } from 'react';
import { Button, TextField } from '../ds/index.ts';
import { api } from '../api.ts';

export type SetupStatus = { needed: boolean; emailsSet: boolean; host: string };

const PERMISSIONS = [
  'Account → Access: Apps and Policies → Edit',
  'Account → Access: Organizations, Identity Providers, and Groups → Edit',
  'Account → Workers Scripts → Read',
];

export function SetupPage({ status }: { status: SetupStatus }) {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ branded: boolean } | null>(null);

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await api<{ done: boolean; branded: boolean }>('POST', '/api/setup', { token });
      setToken('');
      setDone({ branded: r.branded });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-6 px-6 py-12">
      <div className="flex items-center gap-3">
        <img src="/brand/logo.svg" alt="" width={40} height={40} />
        <span className="text-xl font-semibold">Studyflare</span>
      </div>
      <h1 className="text-3xl font-semibold">Finish setting up Studyflare</h1>

      {done ? (
        <div className="flex flex-col gap-4">
          <p className="text-text">
            Your private sign-in is ready. Only the emails you entered when deploying can open Studyflare.
            {done.branded ? ' The sign-in page now shows Studyflare’s name and logo.' : ''}
          </p>
          <p className="text-text-2">Now delete the API token you used (Cloudflare → My Profile → API Tokens). Studyflare didn’t keep it.</p>
          <div>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Go to sign-in
            </Button>
          </div>
        </div>
      ) : !status.emailsSet ? (
        <div className="flex flex-col gap-3 text-text">
          <p>Studyflare doesn’t know who’s allowed in yet.</p>
          <p className="text-text-2">
            In the Cloudflare dashboard, open Workers &amp; Pages → this Worker → Settings → Variables and Secrets, set
            <code className="mx-1 font-mono">ALLOWED_EMAILS</code>to your email, deploy, then reload this page.
          </p>
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p className="text-text-2">
            Studyflare needs a one-time Cloudflare API token to put a private sign-in in front of <strong className="text-text">{status.host}</strong>.
            Until then nobody, including you, can open your study space.
          </p>
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="text-text">
              Create a token at{' '}
              <a className="text-accent underline" href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">
                dash.cloudflare.com/profile/api-tokens
              </a>{' '}
              → Create Token → Custom token, with these permissions for your account:
            </p>
            <ul className="list-disc pl-5 text-text-2">
              {PERMISSIONS.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <TextField
            label="Cloudflare API token"
            type="password"
            autoComplete="off"
            description="Used once for this setup and never stored."
            value={token}
            onChange={(e) => setToken(e.target.value)}
            error={error}
            required
          />
          <div>
            <Button type="submit" variant="primary" loading={busy}>
              Set up sign-in
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
