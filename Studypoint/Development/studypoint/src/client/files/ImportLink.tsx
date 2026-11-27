// Import from a link: paste a web address; a web page is saved as readable text, a PDF/Office/image link
// as the file itself. The Worker only fetches it (browsers can't read other sites); it's type-checked and
// ENCRYPTED here and stored like an upload. Making cards and summaries from it is step 5 (AI).

import { useState } from 'react';
import { Button, TextField, useToast } from '../ds/index.ts';
import { ApiError } from '../api.ts';
import { DuplicateFile, uploadFile } from './filesApi.ts';

async function fetchViaWorker(url: string): Promise<File> {
  let res: Response;
  try {
    res = await fetch('/api/import-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  } catch {
    throw new ApiError(0, 'offline', "Studyflare can't be reached. Check your connection and try again.");
  }
  if (!res.ok) {
    let msg = 'That link couldn’t be imported.';
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, 'import_error', msg);
  }
  if ((res.headers.get('Content-Type') ?? '').includes('application/json')) {
    const page = (await res.json()) as { title: string; markdown: string; url: string };
    const saved = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    const body = `# ${page.title}\n\n> Imported from [${page.url}](${page.url}) on ${saved}.\n\n${page.markdown}\n`;
    return new File([body], `${page.title.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 120) || 'Web page'}.md`, { type: 'text/markdown' });
  }
  const name = decodeURIComponent(res.headers.get('X-Import-Filename') ?? 'download');
  return new File([await res.arrayBuffer()], name);
}

export function ImportLink({ courseId, onImported }: { courseId: string; onImported: () => void }) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async () => {
    setError(null);
    const u = url.trim();
    if (!/^https?:\/\//i.test(u)) return setError('Paste the full address, starting with https://');
    setBusy(true);
    try {
      setStatus('Fetching…');
      const file = await fetchViaWorker(u);
      setStatus('Encrypting and saving…');
      await uploadFile(file, courseId, undefined, 'link');
      setUrl('');
      toast.show({ message: `Imported ${file.name.replace(/\.md$/, '')}` });
      onImported();
    } catch (e) {
      setError(e instanceof DuplicateFile ? 'That page or file is already in your library.' : e instanceof Error ? e.message : 'That link couldn’t be imported.');
    } finally {
      setBusy(false);
      setStatus(null);
    }
  };

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void go();
      }}
    >
      <div className="min-w-64 flex-1">
        <TextField
          label="Or import from a link"
          type="url"
          inputMode="url"
          placeholder="https://… (a web page, or a link to a PDF, Word, PowerPoint or image)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={error}
          description={status ?? 'Web pages are saved as readable text with a link back to the original.'}
        />
      </div>
      <Button type="submit" loading={busy}>
        Import
      </Button>
    </form>
  );
}
