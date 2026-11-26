// School typeahead (INS-01, ARCHITECTURE §3.7). Pure: ranks the bundled IPEDS directory for a query.
// Matches name, aliases ("UMBC"), city and state; tolerates hyphens/punctuation and one typo in longer words.

export type School = {
  id: string;
  name: string;
  aliases: string[];
  city: string;
  state: string;
  level: '2yr' | '4yr';
  domain: string | null;
};

export function normaliseText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STOP = new Set(['of', 'the', 'and', 'at', 'in']);

function within1(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

type Indexed = { school: School; name: string; nameTokens: string[]; aliases: string[]; place: string[] };

export function indexSchools(schools: readonly School[]): Indexed[] {
  return schools.map((school) => {
    const name = normaliseText(school.name);
    return {
      school,
      name,
      nameTokens: name.split(' ').filter(Boolean),
      aliases: school.aliases.map(normaliseText).filter(Boolean),
      place: [...normaliseText(school.city).split(' '), school.state.toLowerCase()].filter(Boolean),
    };
  });
}

/** Score one school for a normalised query; 0 = no match. */
function score(x: Indexed, q: string, qTokens: string[]): number {
  if (x.aliases.includes(q)) return 100;
  if (x.name === q) return 98;
  if (x.name.startsWith(q)) return 85;
  if (x.aliases.some((a) => a.startsWith(q))) return 80;

  // Every meaningful query token must match a name token (prefix), an alias token, or the city/state.
  let nameHits = 0;
  for (const t of qTokens) {
    if (STOP.has(t)) continue;
    const inName = x.nameTokens.some((n) => n.startsWith(t) || (t.length >= 5 && within1(n.slice(0, t.length + 1), t) ) || (t.length >= 5 && within1(n, t)));
    const inAlias = x.aliases.some((a) => a.split(' ').some((n) => n.startsWith(t)));
    const inPlace = x.place.some((p) => p.startsWith(t) || p === t);
    if (!inName && !inAlias && !inPlace) return 0;
    if (inName || inAlias) nameHits += 1;
  }
  if (nameHits === 0) return 0; // a city/state on its own isn't a school match
  return 50 + Math.min(30, nameHits * 6) - Math.min(10, Math.max(0, x.nameTokens.length - qTokens.length));
}

/** Top matches for a query, best first. Empty or 1-character queries return nothing. */
export function searchSchools(index: readonly Indexed[], query: string, limit = 12): School[] {
  const q = normaliseText(query);
  if (q.length < 2) return [];
  const qTokens = q.split(' ').filter(Boolean);
  const hits: Array<{ s: School; score: number }> = [];
  for (const x of index) {
    const sc = score(x, q, qTokens);
    if (sc > 0) hits.push({ s: x.school, score: sc });
  }
  hits.sort((a, b) => b.score - a.score || a.s.name.localeCompare(b.s.name));
  return hits.slice(0, limit).map((h) => h.s);
}
