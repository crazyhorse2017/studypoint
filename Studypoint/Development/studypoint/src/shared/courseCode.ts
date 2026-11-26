// Course codes (INS-02, ARCHITECTURE §3.7). Pure.
// Normalises what Alex types ("chem101", "Phys-121L", "ENGR  1010") to "SUBJ 123" and checks it against
// the school's code format. A mismatch is only a soft warning: schools vary, so never block a code.

export type CourseCode = { subject: string; number: string; normalised: string };

// Subject: 2–5 letters, or an ampersand code such as "A&S". Number: 3–4 digits plus up to 2 letters ("121L").
const CODE_RE = /^\s*([A-Za-z]{1,4}&[A-Za-z]{1,3}|[A-Za-z]{2,5})\s*[-_.\s]?\s*([0-9]{3,4}[A-Za-z]{0,2})\s*$/;

/** Parse a typed course code. Returns null if it doesn't look like SUBJECT + NUMBER at all. */
export function parseCourseCode(input: string): CourseCode | null {
  const m = CODE_RE.exec(input);
  if (!m) return null;
  const subject = (m[1] as string).toUpperCase();
  const number = (m[2] as string).toUpperCase();
  return { subject, number, normalised: `${subject} ${number}` };
}

export type CodeFormat = {
  /** Subject prefixes seen in confirmed codes at this school (from catalog_courses). */
  knownSubjects: ReadonlySet<string>;
  /** Number lengths seen at this school, e.g. {3} or {3, 4}. Empty = unknown. */
  numberLengths: ReadonlySet<number>;
};

/** Learn a school's code format from codes already confirmed there (INS-06 cache). */
export function learnFormat(confirmed: readonly string[]): CodeFormat {
  const knownSubjects = new Set<string>();
  const numberLengths = new Set<number>();
  for (const c of confirmed) {
    const p = parseCourseCode(c);
    if (!p) continue;
    knownSubjects.add(p.subject);
    numberLengths.add((p.number.match(/^[0-9]+/)?.[0] ?? '').length);
  }
  return { knownSubjects, numberLengths };
}

export type CodeCheck =
  | { ok: true; code: CourseCode; warning: string | null }
  | { ok: false; error: string };

/** Check a typed code. Unknown subjects or number lengths give a warning, not an error. */
export function checkCourseCode(input: string, format?: CodeFormat): CodeCheck {
  const code = parseCourseCode(input);
  if (!code) return { ok: false, error: 'Enter a course code like SUBJ 101: letters, then a number.' };
  if (!format) return { ok: true, code, warning: null };
  const digits = (code.number.match(/^[0-9]+/)?.[0] ?? '').length;
  if (format.knownSubjects.size > 0 && !format.knownSubjects.has(code.subject)) {
    return { ok: true, code, warning: `${code.subject} isn't a subject we've seen at this school yet. Check the spelling.` };
  }
  if (format.numberLengths.size > 0 && !format.numberLengths.has(digits)) {
    return { ok: true, code, warning: `Course numbers at this school usually have ${[...format.numberLengths].join(' or ')} digits.` };
  }
  return { ok: true, code, warning: null };
}

/** True if the code appears in text, allowing flexible spacing ("CHEM101" ≈ "CHEM 101"). Used by catalog checks (AI_SYSTEM §13b). */
export function codeAppearsIn(code: CourseCode, text: string): boolean {
  const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&');
  const re = new RegExp(`(^|[^A-Za-z0-9])${escaped(code.subject)}\\s*[-\\u2010-\\u2013]?\\s*${escaped(code.number)}(?![0-9A-Za-z])`, 'i');
  return re.test(text);
}
