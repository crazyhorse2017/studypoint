// School picker (INS-01, DESIGN §6 first run): typeahead over the bundled college directory, with a
// "Not listed" form for any other school (including outside the US).

import { useEffect, useMemo, useState } from 'react';
import { Button, Combobox, TextField } from '../ds/index.ts';
import { searchSchools, type School } from '../../shared/schoolSearch.ts';
import { validateSchool, type SchoolRef } from '../../shared/courses.ts';
import { chooseSchool, loadDirectory } from '../studyStore.ts';

export function SchoolPicker({ onDone }: { onDone?: (s: SchoolRef) => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState<Awaited<ReturnType<typeof loadDirectory>> | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [manual, setManual] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadDirectory().then(setIndex).catch(() => setLoadError(true));
  }, []);

  const results = useMemo(() => (index ? searchSchools(index, query) : []), [index, query]);

  const save = async (school: SchoolRef) => {
    setSaving(true);
    setError(null);
    try {
      await chooseSchool(school);
      onDone?.(school);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  if (manual || loadError) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          const v = validateSchool({ unitid: null, name, domain });
          if (!v.ok) setError(v.error);
          else void save(v.value);
        }}
      >
        {loadError ? <p className="text-sm text-text-2">The college list didn't load, so enter your school yourself.</p> : null}
        <TextField label="School name" required value={name} onChange={(e) => setName(e.target.value)} />
        <TextField
          label="School website"
          description="Used later to look up course codes on your school's own site. Optional."
          placeholder="school.edu"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
        />
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={saving}>
            Save school
          </Button>
          {!loadError ? (
            <Button onClick={() => setManual(false)} variant="ghost">
              Back to search
            </Button>
          ) : null}
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Combobox<School>
        label="Your school"
        description={index ? 'Search by name, short name like UMBC, or city.' : 'Loading the college list…'}
        placeholder="Start typing your school's name"
        query={query}
        onQueryChange={setQuery}
        options={results}
        getKey={(s) => s.id}
        getLabel={(s) => `${s.name}, ${s.city}, ${s.state}, ${s.level === '2yr' ? 'two-year' : 'four-year'}`}
        renderOption={(s) => (
          <span className="flex items-center justify-between gap-3">
            <span className="flex flex-col">
              <span>{s.name}</span>
              <span className="text-sm text-text-2">
                {s.city}, {s.state}
              </span>
            </span>
            <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-xs text-text-2">{s.level === '2yr' ? '2-year' : '4-year'}</span>
          </span>
        )}
        onSelect={(s) => void save({ unitid: s.id, name: s.name, domain: s.domain })}
        emptyText="No colleges match that."
        footer={
          <button type="button" className="text-sm text-accent underline underline-offset-2" onClick={() => setManual(true)}>
            Not listed? Enter your school
          </button>
        }
      />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {saving ? <p className="text-sm text-text-2">Saving…</p> : null}
    </div>
  );
}
