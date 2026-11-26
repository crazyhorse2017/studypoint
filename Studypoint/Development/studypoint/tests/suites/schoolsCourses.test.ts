// INS-01 school search against the REAL bundled directory, and INS-02 course validation.

import { indexSchools, normaliseText, searchSchools, type School } from '../../src/shared/schoolSearch.ts';
import { validateCourse, validateSchool } from '../../src/shared/courses.ts';
import { ROUTES, createApp, type Env } from '../../src/worker/app.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

let cached: ReturnType<typeof indexSchools> | null = null;
async function directory() {
  if (!cached) {
    const res = await fetch('../public/data/institutions.json');
    const doc = (await res.json()) as { count: number; institutions: School[] };
    cached = indexSchools(doc.institutions);
  }
  return cached;
}

const top = async (q: string, n = 3) => searchSchools(await directory(), q, n).map((s) => s.name);

export function register(test: TestFn, assert: Assert): void {
  test('schools: directory loads with thousands of active 2- and 4-year colleges', async () => {
    const idx = await directory();
    assert.ok(idx.length > 3500, `only ${idx.length}`);
    assert.ok(idx.some((x) => x.school.level === '2yr') && idx.some((x) => x.school.level === '4yr'));
    assert.ok(idx.every((x) => /^\d{6}$/.test(x.school.id)), 'every school has a 6-digit UNITID');
  });

  test('schools: "UMBC" finds University of Maryland-Baltimore County first', async () => {
    const r = await top('UMBC');
    assert.equal(r[0], 'University of Maryland-Baltimore County');
    const s = searchSchools(await directory(), 'umbc', 1)[0];
    assert.equal(s?.domain, 'umbc.edu');
  });

  test('schools: the full name works without the hyphen, and partial words work', async () => {
    assert.equal((await top('university of maryland baltimore county'))[0], 'University of Maryland-Baltimore County');
    assert.ok((await top('univ maryland balt', 5)).includes('University of Maryland-Baltimore County'));
  });

  test('schools: community colleges are included', async () => {
    assert.equal((await top('montgomery college'))[0], 'Montgomery College');
    assert.ok((await top('ccbc', 5)).includes('Community College of Baltimore County'));
  });

  test('schools: one typo in a longer word still matches', async () => {
    assert.ok((await top('towsen university', 5)).includes('Towson University'));
  });

  test('schools: a city alone does not match schools merely located there; 1-char queries return nothing', async () => {
    // Montgomery College is in Rockville, MD, but "rockville" isn't in its name or aliases.
    assert.ok(!(await top('rockville', 20)).includes('Montgomery College'));
    // City narrows a name search though: "montgomery rockville" keeps it.
    assert.ok((await top('montgomery rockville', 5)).includes('Montgomery College'));
    assert.equal((await top('u')).length, 0);
  });

  test('schools: text normalisation drops accents, punctuation and "&"', () => {
    assert.equal(normaliseText('Texas A&M University–Commerce'), 'texas a and m university commerce');
    assert.equal(normaliseText('Université'), 'universite');
  });

  test('courses: code normalised, title optional, school required', () => {
    const home = { unitid: '163268', name: 'Example University', domain: 'example.edu' };
    const ok = validateCourse({ code: 'chem101', title: ' General   Chemistry ' }, home);
    assert.ok(ok.ok && ok.value.code === 'CHEM 101' && ok.value.title === 'General Chemistry');
    const codeOnly = validateCourse({ code: 'PHYS 121L' }, home);
    assert.ok(codeOnly.ok && codeOnly.value.title === 'PHYS 121L');
    assert.ok(!validateCourse({ code: 'hello' }, home).ok);
    assert.ok(!validateCourse({}, home).ok);
    assert.ok(!validateCourse({ code: 'CHEM 101' }, null).ok, 'needs a school');
    assert.ok(!validateCourse({ title: 'x'.repeat(161) }, home).ok);
  });

  test('schools: manual "Not listed" input is validated', () => {
    const v = validateSchool({ unitid: null, name: '  Some  College ', domain: 'https://www.some.ac.uk/' });
    assert.ok(v.ok && v.value.name === 'Some College' && v.value.domain === 'some.ac.uk');
    assert.ok(!validateSchool({ name: 'X' }).ok);
    assert.ok(!validateSchool({ name: 'Good Name', domain: 'not a domain' }).ok);
    assert.ok(!validateSchool({ name: 'Good Name', unitid: '12' }).ok);
  });

  test('api: course routes with :id params are matched and still require sign-in', async () => {
    assert.ok(ROUTES.some((r) => r.path === '/api/courses/:id' && r.method === 'PATCH'));
    const app = createApp({ makeVerifier: () => async (t) => { if (t === 'ok') return { email: 'alex@example.com' }; throw new Error('bad'); } });
    const env = { ASSETS: {} as Fetcher, ENVIRONMENT: 'production', ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com', ACCESS_AUD: 'aud', ALLOWED_EMAILS: 'alex@example.com' } as Env;
    const anon = await app.fetch(new Request('https://x.test/api/courses/abc', { method: 'DELETE' }), env);
    assert.equal(anon.status, 401);
    const signed = await app.fetch(new Request('https://x.test/api/courses/abc', { method: 'DELETE', headers: { 'Cf-Access-Jwt-Assertion': 'ok' } }), env);
    assert.equal(signed.status, 503, 'matched the :id route; no DB bound in the test');
    const wrong = await app.fetch(new Request('https://x.test/api/courses/abc', { method: 'GET', headers: { 'Cf-Access-Jwt-Assertion': 'ok' } }), env);
    assert.equal(wrong.status, 405);
  });
}
