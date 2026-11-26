// Settings → People (AUTH-06): owners add or remove the emails that can sign in. Each person gets a
// separate account. Built-in owner emails can't be removed here, so the owner can't be locked out.

import { useEffect, useState } from 'react';
import { Button, ConfirmDialog, TextField, useToast } from '../ds/index.ts';
import { api } from '../api.ts';

type Person = { email: string; role: 'owner' | 'member'; builtIn: boolean; addedAt: number | null };

export function PeopleSection() {
  const toast = useToast();
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    api<{ people: Person[] }>('GET', '/api/people')
      .then((r) => setPeople(r.people))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Something went wrong.'));
  }, []);

  const add = async () => {
    setError(null);
    setSaving(true);
    try {
      const r = await api<{ people: Person[] }>('POST', '/api/people', { email });
      setPeople(r.people);
      toast.show({ message: `${email.trim().toLowerCase()} can now sign in` });
      setEmail('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (who: string) => {
    try {
      const r = await api<{ people: Person[] }>('DELETE', `/api/people/${encodeURIComponent(who)}`);
      setPeople(r.people);
      toast.show({ message: `${who} can no longer sign in` });
    } catch (e) {
      toast.show({ message: e instanceof Error ? e.message : 'Something went wrong.', tone: 'error' });
    }
  };

  return (
    <section aria-labelledby="people-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="people-heading" className="text-xl font-semibold">
          People
        </h2>
        <p className="text-sm text-text-2">
          Everyone here can sign in. Each person gets their own separate account and never sees your courses or files.
        </p>
      </div>
      {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}
      {people ? (
        <ul className="rounded-lg border border-border bg-surface px-4">
          {people.map((p) => (
            <li key={p.email} className="flex flex-wrap items-center justify-between gap-3 border-b border-border py-3 last:border-0">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-text">{p.email}</span>
                <span className="text-sm text-text-3">{p.role === 'owner' ? 'Owner: opens your account' : 'Own separate account'}</span>
              </span>
              {p.builtIn ? (
                <span className="text-sm text-text-3">Built in</span>
              ) : (
                <Button size="sm" variant="danger" onClick={() => setRemoving(p.email)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : !loadError ? (
        <p className="text-text-2">Loading…</p>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="min-w-64 flex-1">
          <TextField label="Add someone" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
        </div>
        <Button type="submit" variant="primary" loading={saving}>
          Add person
        </Button>
      </form>
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing ?? ''}?`}
        message="They won't be able to sign in any more. Their account and anything they added stay saved in case you add them back."
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const who = removing;
          setRemoving(null);
          if (who) void remove(who);
        }}
      />
    </section>
  );
}
