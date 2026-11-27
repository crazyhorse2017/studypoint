// Course and home-school input validation (INS-01/02, LIB-01). Pure, shared by client and Worker.

import { parseCourseCode } from './courseCode.ts';

export type SchoolRef = { unitid: string | null; name: string; domain: string | null };

/** 'college' courses belong to a school and may have a code; 'personal' ones are just a subject (LIB-01b). */
export type CourseKind = 'college' | 'personal';

export type CourseInput = {
  kind: CourseKind;
  code: string | null; // normalised "SUBJ 123" or null
  subject: string | null;
  number: string | null;
  title: string;
  /** Null for personal courses. */
  school: SchoolRef | null;
};

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export function validateSchool(input: unknown): Validated<SchoolRef> {
  const r = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const name = typeof r['name'] === 'string' ? r['name'].trim().replace(/\s+/g, ' ') : '';
  if (name.length < 2 || name.length > 150) return { ok: false, error: 'Enter your school’s name.' };
  const unitid = r['unitid'];
  if (unitid !== null && unitid !== undefined && !(typeof unitid === 'string' && /^\d{6}$/.test(unitid))) {
    return { ok: false, error: 'That school ID isn’t valid.' };
  }
  let domain: string | null = null;
  if (typeof r['domain'] === 'string' && r['domain'].trim() !== '') {
    const d = r['domain'].trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? '';
    if (!DOMAIN_RE.test(d)) return { ok: false, error: 'Enter the website like school.edu, or leave it blank.' };
    domain = d;
  }
  return { ok: true, value: { unitid: typeof unitid === 'string' ? unitid : null, name, domain } };
}

/**
 * Validate a new course. College: needs a school; the code is optional; a title or a code is required.
 * Personal: just a name. No school and no code (the code field is rejected, not silently dropped).
 */
export function validateCourse(input: unknown, homeSchool: SchoolRef | null): Validated<CourseInput> {
  const r = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  if (r['kind'] === 'personal') {
    const name = typeof r['title'] === 'string' ? r['title'].trim().replace(/\s+/g, ' ') : '';
    if (!name) return { ok: false, error: 'Name the subject, like “Astronomy” or “Learning Italian”.' };
    if (name.length > 160) return { ok: false, error: 'Keep the name under 160 characters.' };
    if (typeof r['code'] === 'string' && r['code'].trim() !== '') return { ok: false, error: 'Personal subjects don’t have course codes.' };
    return { ok: true, value: { kind: 'personal', code: null, subject: null, number: null, title: name, school: null } };
  }
  if (r['kind'] !== undefined && r['kind'] !== 'college') return { ok: false, error: 'Unknown course type.' };
  const school = r['school'] === undefined ? homeSchool : validateSchool(r['school']).ok ? (validateSchool(r['school']) as { value: SchoolRef }).value : null;
  if (!school) return { ok: false, error: 'Choose your school first.' };

  const rawCode = typeof r['code'] === 'string' ? r['code'].trim() : '';
  let code: CourseInput['code'] = null;
  let subject: string | null = null;
  let number: string | null = null;
  if (rawCode) {
    const parsed = parseCourseCode(rawCode);
    if (!parsed) return { ok: false, error: 'Enter a course code like SUBJ 101: letters, then a number.' };
    code = parsed.normalised;
    subject = parsed.subject;
    number = parsed.number;
  }
  const title = typeof r['title'] === 'string' ? r['title'].trim().replace(/\s+/g, ' ') : '';
  if (title.length > 160) return { ok: false, error: 'Keep the course title under 160 characters.' };
  if (!title && !code) return { ok: false, error: 'Enter a course code, a title, or both.' };
  return { ok: true, value: { kind: 'college', code, subject, number, title: title || (code as string), school } };
}
