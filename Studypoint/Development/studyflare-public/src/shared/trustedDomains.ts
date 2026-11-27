// Trusted web lookup (LKP-01): the allowlist and blocklist, enforced IN CODE on every result's final URL
// (ARCHITECTURE A10), not only via the search provider's include_domains parameter. Pure, so it's tested
// locally. Changes need review: this list decides what the assistant may cite from the web.

/** Exact sites (and their subdomains) that are always allowed. */
export const ALLOWED_SITES: readonly string[] = [
  // Open textbooks and courseware
  'openstax.org', 'ocw.mit.edu', 'libretexts.org', 'oyc.yale.edu', 'see.stanford.edu', 'open.umn.edu', 'pressbooks.pub', 'opentextbc.ca',
  'hyperphysics.phy-astr.gsu.edu', 'tutorial.math.lamar.edu', 'khanacademy.org', 'feynmanlectures.caltech.edu',
  // Government, standards and science agencies
  'nist.gov', 'nasa.gov', 'energy.gov', 'epa.gov', 'noaa.gov', 'usgs.gov', 'nih.gov', 'ncbi.nlm.nih.gov', 'osha.gov', 'nrc.gov', 'iso.org', 'ieee.org', 'asme.org', 'astm.org', 'bipm.org',
  // Scholarly
  'doi.org', 'arxiv.org', 'nature.com', 'science.org', 'sciencedirect.com', 'springer.com', 'link.springer.com', 'pubs.acs.org', 'aip.org', 'iop.org', 'jstor.org', 'pnas.org',
  // Official documentation
  'docs.python.org', 'numpy.org', 'scipy.org', 'mathworks.com', 'developer.mozilla.org',
];

/** Whole top-level domains that are allowed: US universities and US government. */
export const ALLOWED_SUFFIXES: readonly string[] = ['.edu', '.gov', '.mil', '.ac.uk'];

/** Never allowed, even under an allowed suffix (LKP-01 hard blocklist). */
export const BLOCKED_SITES: readonly string[] = [
  'wikipedia.org', 'wikiwand.com', 'chegg.com', 'coursehero.com', 'quizlet.com', 'brainly.com', 'studocu.com', 'scribd.com', 'bartleby.com',
  'answers.com', 'quora.com', 'reddit.com', 'medium.com', 'perplexity.ai', 'chatgpt.com', 'gemini.google.com', 'you.com', 'numerade.com', 'slader.com',
];

function host(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return null;
  }
}

const onSite = (h: string, site: string) => h === site || h.endsWith(`.${site}`);

/** Is this URL from a trusted source? Blocklist wins over everything. */
export function isTrustedUrl(url: string): boolean {
  const h = host(url);
  if (!h) return false;
  if (BLOCKED_SITES.some((s) => onSite(h, s))) return false;
  return ALLOWED_SITES.some((s) => onSite(h, s)) || ALLOWED_SUFFIXES.some((s) => h.endsWith(s));
}

/** The include_domains list for the search provider (max 300): every allowed site plus the suffixes. */
export function searchDomains(): string[] {
  return [...ALLOWED_SITES, ...ALLOWED_SUFFIXES.map((s) => s.replace(/^\./, ''))].slice(0, 300);
}
