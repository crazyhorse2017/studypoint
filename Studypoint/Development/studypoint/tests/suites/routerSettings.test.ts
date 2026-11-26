// Router matching (ARCHITECTURE A12b) and the shared settings model (UX-01/03).

import { buildPath, isActive, matchPath, shouldInterceptClick } from '../../src/client/routeMatch.ts';
import { DEFAULT_APPEARANCE, DEFAULT_READING, mergeAppearance, normaliseReading, readingCssVars } from '../../src/shared/settings.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void; throws(fn: () => unknown, m?: string): void };

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };

export function register(test: TestFn, assert: Assert): void {
  test('router: matches static paths and :params, ignoring trailing slashes', () => {
    assert.deepEqual(matchPath('/', '/'), {});
    assert.deepEqual(matchPath('/settings', '/settings/'), {});
    assert.deepEqual(matchPath('/source/:id', '/source/abc%20d'), { id: 'abc d' });
    assert.equal(matchPath('/source/:id', '/source'), null);
    assert.equal(matchPath('/library', '/libraryx'), null);
    assert.equal(matchPath('/source/:id', '/source/%E0%A4%A'), null, 'malformed encoding is a non-match, not a crash');
  });

  test('router: buildPath encodes params and query (citation deep links)', () => {
    assert.equal(buildPath('/source/:id', { id: 'a/b' }, { page: 12, passage: 'p 1', skip: undefined }), '/source/a%2Fb?page=12&passage=p+1');
    assert.throws(() => buildPath('/source/:id'));
  });

  test('router: only plain same-origin left-clicks are intercepted', () => {
    const o = 'https://studypoint.example';
    assert.ok(shouldInterceptClick(click, null, '/library', o));
    assert.ok(!shouldInterceptClick({ ...click, ctrlKey: true }, null, '/library', o), 'Ctrl+click opens a new tab');
    assert.ok(!shouldInterceptClick({ ...click, button: 1 }, null, '/library', o), 'middle click');
    assert.ok(!shouldInterceptClick(click, '_blank', '/library', o));
    assert.ok(!shouldInterceptClick(click, null, 'https://other.example/x', o), 'external links go to the browser');
  });

  test('shell: active nav item, where Today is only active on /', () => {
    assert.ok(isActive('/', '/'));
    assert.ok(!isActive('/', '/library'));
    assert.ok(isActive('/library', '/library/abc'));
    assert.ok(!isActive('/library', '/libraryx'));
  });

  test('settings: reading prefs are clamped, snapped and defaulted', () => {
    const r = normaliseReading({ font: 'comic-sans', sizePct: 500, letterSpacingEm: 0.033, lineHeight: 'big', widthCh: 61, reduceMotion: 'yes', extra: 1 });
    assert.equal(r.font, 'style');
    assert.equal(r.sizePct, 160);
    assert.equal(r.letterSpacingEm, 0.03);
    assert.equal(r.lineHeight, DEFAULT_READING.lineHeight);
    assert.equal(r.widthCh, 62, '61 is halfway between 60 and 62 on the 2-ch grid and rounds up');
    assert.equal(r.reduceMotion, false);
    assert.ok(!('extra' in r), 'unknown fields are dropped');
  });

  test('settings: PATCH merge keeps current values for invalid fields', () => {
    const cur = { ...DEFAULT_APPEARANCE, style: 'lab' as const };
    const next = mergeAppearance(cur, { style: 'neon', theme: 'dark', reading: { sizePct: 120 } });
    assert.equal(next.style, 'lab');
    assert.equal(next.theme, 'dark');
    assert.equal(next.reading.sizePct, 120);
    assert.equal(next.reading.lineHeight, DEFAULT_READING.lineHeight, 'untouched reading fields stay');
    assert.deepEqual(mergeAppearance(cur, null), cur);
  });

  test('settings: CSS variables for reading, where "style default" removes the font override', () => {
    const vars = readingCssVars({ ...DEFAULT_READING, sizePct: 120, widthCh: 60 });
    assert.equal(vars['--fs-reading'], '1.35rem');
    assert.equal(vars['--reading-width'], '60ch');
    assert.equal(vars['--ff-reading-override'], null);
    assert.ok(String(readingCssVars({ ...DEFAULT_READING, font: 'opendyslexic' })['--ff-reading-override']).includes('OpenDyslexic'));
  });
}
