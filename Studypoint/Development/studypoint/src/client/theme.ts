// Style + theme resolution (DESIGN §2.8, UX-01).
// Style and theme are separate settings. "system" follows the OS; if the OS states no
// preference, each style falls back to its natural theme (Paper and Lab: light, Midnight: dark).

import { readingCssVars, type ReadingPrefs, type StyleName, type ThemePref } from '../shared/settings.ts';

export type { StyleName, ThemePref };
export type ResolvedTheme = 'light' | 'dark';
export type OsScheme = 'light' | 'dark' | 'no-preference';

export const STYLES: readonly StyleName[] = ['paper', 'lab', 'midnight'];
export const DEFAULT_STYLE: StyleName = 'paper';

const NATURAL_THEME: Record<StyleName, ResolvedTheme> = {
  paper: 'light',
  lab: 'light',
  midnight: 'dark',
};

export function isStyleName(value: unknown): value is StyleName {
  return value === 'paper' || value === 'lab' || value === 'midnight';
}

export function isThemePref(value: unknown): value is ThemePref {
  return value === 'system' || value === 'light' || value === 'dark';
}

/** Pure: which theme to render for a style, preference and OS colour scheme. */
export function resolveTheme(style: StyleName, pref: ThemePref, os: OsScheme): ResolvedTheme {
  if (pref === 'light' || pref === 'dark') return pref;
  if (os === 'light' || os === 'dark') return os;
  return NATURAL_THEME[style];
}

/** Read the OS colour scheme. */
export function readOsScheme(): OsScheme {
  if (typeof matchMedia !== 'function') return 'no-preference';
  if (matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  if (matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'no-preference';
}

/** Apply reading preferences (UX-03) and reduce-motion to <html> as CSS custom properties / attributes. */
export function applyReading(prefs: ReadingPrefs, root: HTMLElement = document.documentElement): void {
  for (const [name, value] of Object.entries(readingCssVars(prefs))) {
    if (value === null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  }
  root.dataset['reduceMotion'] = prefs.reduceMotion ? 'true' : 'false';
}

/** Apply a style and theme to <html>. Tokens in styles/tokens.css key off these attributes. */
export function applyAppearance(style: StyleName, pref: ThemePref, root: HTMLElement = document.documentElement): ResolvedTheme {
  const theme = resolveTheme(style, pref, readOsScheme());
  root.dataset['style'] = style;
  root.dataset['theme'] = theme;
  return theme;
}
