import { STYLES, isStyleName, isThemePref, resolveTheme } from '../../src/client/theme.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void };

export function register(test: TestFn, assert: Assert): void {
  test('theme: an explicit light/dark preference always wins', () => {
    for (const style of STYLES) {
      assert.equal(resolveTheme(style, 'light', 'dark'), 'light');
      assert.equal(resolveTheme(style, 'dark', 'light'), 'dark');
    }
  });

  test('theme: "system" follows the OS scheme', () => {
    for (const style of STYLES) {
      assert.equal(resolveTheme(style, 'system', 'dark'), 'dark');
      assert.equal(resolveTheme(style, 'system', 'light'), 'light');
    }
  });

  test('theme: with no OS preference, each style uses its natural theme (DESIGN §2.8)', () => {
    assert.equal(resolveTheme('paper', 'system', 'no-preference'), 'light');
    assert.equal(resolveTheme('lab', 'system', 'no-preference'), 'light');
    assert.equal(resolveTheme('midnight', 'system', 'no-preference'), 'dark');
  });

  test('theme: guards accept only known values', () => {
    assert.ok(isStyleName('paper') && isStyleName('lab') && isStyleName('midnight'));
    assert.ok(!isStyleName('neon') && !isStyleName(undefined));
    assert.ok(isThemePref('system') && !isThemePref('auto'));
  });

  test('theme: applying a style + theme sets <html> data attributes', async () => {
    const { applyAppearance } = await import('../../src/client/theme.ts');
    const el = document.createElement('div');
    const theme = applyAppearance('midnight', 'dark', el);
    assert.equal(theme, 'dark');
    assert.equal(el.dataset['style'], 'midnight');
    assert.equal(el.dataset['theme'], 'dark');
  });
}
