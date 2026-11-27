// Import from a link (step 4 extra, LKP-02-lite). The Worker fetches the URL because browsers can't read
// other sites (CORS). A web page comes back as readable Markdown (JSON); a PDF/Office/image file comes
// back as its bytes. The BROWSER then type-checks, encrypts and stores it like an upload, so nothing
// fetched is kept on the server. Turning imported material into cards and summaries is step 5 (AI).
//
// SSRF guard: http(s) only, normal ports, no credentials, no IP literals or local names, every redirect
// re-checked, a size cap and a timeout. Workers can't reach private networks anyway; this is belt and braces.

import { eventsToMarkdown, type HtmlEvent } from '../shared/htmlToMarkdown.ts';

export class ImportError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ImportError';
    this.status = status;
  }
}

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
const UA = 'Studyflare/0.1 (+https://github.com/crazyhorse2017/studyflare; study-material import)';

/** Rejects anything that isn't a plain public http(s) address. Returns the normalised URL. */
export function checkImportUrl(raw: unknown): URL {
  if (typeof raw !== 'string' || raw.length > 2000) throw new ImportError(400, 'Paste a full web address, starting with https://');
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new ImportError(400, 'That isn’t a web address. Paste the full link, starting with https://');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ImportError(400, 'Only http and https links can be imported.');
  if (u.username || u.password) throw new ImportError(400, 'Links with a username or password can’t be imported.');
  if (u.port && u.port !== '80' && u.port !== '443') throw new ImportError(400, 'Links on unusual ports can’t be imported.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const ipv6 = host.startsWith('[') || host.includes(':');
  const local = host === 'localhost' || !host.includes('.') || /\.(local|localhost|internal|lan|home|intranet|corp|test|invalid)$/.test(host);
  if (ipv4 || ipv6 || local) throw new ImportError(400, 'That address isn’t a public website.');
  u.hash = '';
  return u;
}

async function readCapped(res: Response): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get('Content-Length') ?? '0');
  if (declared > MAX_IMPORT_BYTES) throw new ImportError(413, 'That file is over 50 MB, too large to import from a link. Download it and upload it instead (up to 100 MB).');
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMPORT_BYTES) {
      await reader.cancel();
      throw new ImportError(413, 'That file is over 50 MB, too large to import from a link.');
    }
    parts.push(value);
  }
  const out = new Uint8Array(new ArrayBuffer(total));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Fetch with redirects followed by hand, so every hop passes checkImportUrl. */
async function fetchChecked(start: URL): Promise<{ res: Response; url: URL }> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let res: Response;
    try {
      res = await fetch(url.toString(), { redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
      throw new ImportError(502, 'That site didn’t answer. Check the link, or try again later.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('Location')) {
      url = checkImportUrl(new URL(res.headers.get('Location') as string, url).toString());
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new ImportError(502, 'That site needs a sign-in or blocks automatic downloads. Save the page or file yourself and upload it.');
    if (res.status === 404) throw new ImportError(502, 'That page doesn’t exist (404).');
    if (!res.ok) throw new ImportError(502, `That site answered with an error (${res.status}).`);
    return { res, url };
  }
  throw new ImportError(502, 'That link redirects too many times.');
}

function filenameFrom(res: Response, url: URL): string {
  const cd = res.headers.get('Content-Disposition') ?? '';
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const raw = m?.[1] ?? decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '') ?? '';
  return raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 150) || url.hostname;
}

/** Collect HTMLRewriter events for the page (Workers runtime only). */
async function pageEvents(res: Response): Promise<HtmlEvent[]> {
  const events: HtmlEvent[] = [];
  const rewriter = new HTMLRewriter()
    .on('*', {
      element(el) {
        const attrs: Record<string, string> = {};
        const alt = el.getAttribute('alt');
        if (alt) attrs['alt'] = alt;
        events.push({ kind: 'open', tag: el.tagName, attrs });
        try {
          el.onEndTag((end) => {
            events.push({ kind: 'close', tag: end.name });
          });
        } catch {
          // void elements (br, img, hr) have no end tag
        }
      },
      text(t) {
        if (t.text) events.push({ kind: 'text', text: t.text });
      },
    });
  await rewriter.transform(res).arrayBuffer();
  return events;
}

export async function importUrl(raw: unknown): Promise<Response> {
  const { res, url } = await fetchChecked(checkImportUrl(raw));
  const type = (res.headers.get('Content-Type') ?? '').toLowerCase();
  const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (type.includes('text/html') || type.includes('application/xhtml+xml')) {
    const declared = Number(res.headers.get('Content-Length') ?? '0');
    if (declared > 10 * 1024 * 1024) throw new ImportError(413, 'That page is too large to import.');
    const { title, markdown } = eventsToMarkdown(await pageEvents(res));
    if (markdown.replace(/\s/g, '').length < 80) throw new ImportError(422, 'That page has almost no readable text (it may need JavaScript or a sign-in). Try a PDF version, or save the page and upload it.');
    return new Response(JSON.stringify({ kind: 'page', title: title || url.hostname, markdown, url: url.toString() }), {
      headers: { ...noStore, 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  const bytes = await readCapped(res);
  return new Response(bytes, {
    headers: {
      ...noStore,
      'Content-Type': 'application/octet-stream',
      'X-Import-Filename': encodeURIComponent(filenameFrom(res, url)),
      'X-Import-Url': encodeURIComponent(url.toString()),
    },
  });
}
