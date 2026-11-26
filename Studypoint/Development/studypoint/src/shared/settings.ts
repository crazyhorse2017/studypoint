// User settings model shared by the client and the Worker (UX-01/03/06, DATABASE settings table).
// Pure validation: unknown fields are dropped and values are clamped or defaulted,
// so a bad PATCH can never store something the UI can't render.

export type StyleName = 'paper' | 'lab' | 'midnight';
export type ThemePref = 'system' | 'light' | 'dark';
export type ReadingFont = 'style' | 'literata' | 'inter' | 'atkinson' | 'opendyslexic';

/** Stored in settings.reading_json: reading and appearance preferences (UX-03, DESIGN §8). */
export type ReadingPrefs = {
  font: ReadingFont;
  /** Reading text size as a % of the default (90–160). */
  sizePct: number;
  /** Extra letter spacing in em (0–0.12). */
  letterSpacingEm: number;
  /** Line height (1.5–2.0). */
  lineHeight: number;
  /** Reading column width in characters (50–80). */
  widthCh: number;
  reduceMotion: boolean;
  /** Single-key shortcuts on/off (WCAG 2.1.4, DESIGN §7). */
  shortcuts: boolean;
};

export type AppearanceSettings = {
  style: StyleName;
  theme: ThemePref;
  reading: ReadingPrefs;
};

export const DEFAULT_READING: ReadingPrefs = {
  font: 'style',
  sizePct: 100,
  letterSpacingEm: 0,
  lineHeight: 1.7,
  widthCh: 68,
  reduceMotion: false,
  shortcuts: true,
};

export const DEFAULT_APPEARANCE: AppearanceSettings = { style: 'paper', theme: 'system', reading: DEFAULT_READING };

export const READING_LIMITS = {
  sizePct: { min: 90, max: 160, step: 5 },
  letterSpacingEm: { min: 0, max: 0.12, step: 0.01 },
  lineHeight: { min: 1.5, max: 2, step: 0.05 },
  widthCh: { min: 50, max: 80, step: 2 },
} as const;

const STYLES: readonly StyleName[] = ['paper', 'lab', 'midnight'];
const THEMES: readonly ThemePref[] = ['system', 'light', 'dark'];
const FONTS: readonly ReadingFont[] = ['style', 'literata', 'inter', 'atkinson', 'opendyslexic'];

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function num(value: unknown, limits: { min: number; max: number; step: number }, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const clamped = Math.min(limits.max, Math.max(limits.min, value));
  const steps = Math.round((clamped - limits.min) / limits.step);
  return Number((limits.min + steps * limits.step).toFixed(4));
}

const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);

export function normaliseReading(input: unknown, base: ReadingPrefs = DEFAULT_READING): ReadingPrefs {
  const r = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  return {
    font: pick(r['font'], FONTS, base.font),
    sizePct: num(r['sizePct'], READING_LIMITS.sizePct, base.sizePct),
    letterSpacingEm: num(r['letterSpacingEm'], READING_LIMITS.letterSpacingEm, base.letterSpacingEm),
    lineHeight: num(r['lineHeight'], READING_LIMITS.lineHeight, base.lineHeight),
    widthCh: num(r['widthCh'], READING_LIMITS.widthCh, base.widthCh),
    reduceMotion: bool(r['reduceMotion'], base.reduceMotion),
    shortcuts: bool(r['shortcuts'], base.shortcuts),
  };
}

/** Apply a partial update on top of current settings (PATCH semantics). Invalid fields keep their current value. */
export function mergeAppearance(current: AppearanceSettings, patch: unknown): AppearanceSettings {
  const p = (typeof patch === 'object' && patch !== null ? patch : {}) as Record<string, unknown>;
  return {
    style: pick(p['style'], STYLES, current.style),
    theme: pick(p['theme'], THEMES, current.theme),
    reading: p['reading'] === undefined ? current.reading : normaliseReading({ ...current.reading, ...(p['reading'] as object) }, current.reading),
  };
}

const FONT_STACK: Record<Exclude<ReadingFont, 'style'>, string> = {
  literata: "'Literata Variable', Literata, Georgia, serif",
  inter: "'Inter Variable', Inter, ui-sans-serif, system-ui, sans-serif",
  atkinson: "'Atkinson Hyperlegible', ui-sans-serif, system-ui, sans-serif",
  opendyslexic: "OpenDyslexic, 'Atkinson Hyperlegible', ui-sans-serif, sans-serif",
};

/** CSS custom properties for the reading settings (consumed by the .reading class in styles.css). */
export function readingCssVars(r: ReadingPrefs): Record<string, string | null> {
  return {
    '--fs-reading': `${(1.125 * r.sizePct) / 100}rem`,
    '--lh-reading': String(r.lineHeight),
    '--ls-reading': `${r.letterSpacingEm}em`,
    '--reading-width': `${r.widthCh}ch`,
    // null = remove the override so the style's own reading font applies.
    '--ff-reading-override': r.font === 'style' ? null : FONT_STACK[r.font],
  };
}
