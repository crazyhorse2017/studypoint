// Trusted web lookup through Tavily (LKP-01, ARCHITECTURE A9/A10). Only the search QUERY leaves Studyflare;
// results are filtered again in code against the allowlist (an API parameter isn't a guarantee), and the
// page text Tavily returns is treated as data by every prompt.

import { BLOCKED_SITES, isTrustedUrl, searchDomains } from '../../shared/trustedDomains.ts';

export class LookupError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'LookupError';
    this.status = status;
  }
}

export type WebResult = { url: string; title: string; content: string; score: number };

export async function trustedSearch(apiKey: string | undefined, query: unknown, fetchImpl: typeof fetch = fetch): Promise<WebResult[]> {
  if (!apiKey) throw new LookupError(503, 'Web lookup isn’t set up yet: add a TAVILY_API_KEY secret to this Studyflare (free at tavily.com).');
  if (typeof query !== 'string' || query.trim().length < 3 || query.length > 400) throw new LookupError(400, 'Type a question to look up (3–400 characters).');
  let res: Response;
  try {
    res = await fetchImpl('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query: query.trim(),
        search_depth: 'basic',
        max_results: 8,
        include_raw_content: false,
        include_answer: false,
        include_domains: searchDomains(),
        exclude_domains: BLOCKED_SITES,
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new LookupError(502, 'The web search didn’t answer. Try again in a moment.');
  }
  if (res.status === 401 || res.status === 403) throw new LookupError(502, 'The Tavily key was refused. Check the TAVILY_API_KEY secret.');
  if (res.status === 429 || res.status === 432) throw new LookupError(429, 'This month’s free web searches are used up.');
  if (!res.ok) throw new LookupError(502, `The web search failed (${res.status}).`);
  const data = (await res.json()) as { results?: Array<{ url?: string; title?: string; content?: string; score?: number }> };
  return (data.results ?? [])
    .filter((r) => typeof r.url === 'string' && isTrustedUrl(r.url))
    .map((r) => ({ url: r.url as string, title: (r.title ?? r.url ?? '').slice(0, 200), content: (r.content ?? '').slice(0, 4000), score: Number(r.score) || 0 }));
}
