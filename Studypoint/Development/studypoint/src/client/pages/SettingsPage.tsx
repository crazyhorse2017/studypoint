// Settings v1 (T0.20; UX-01, UX-03, UX-06 partial). Appearance, reading and motion/shortcut settings,
// applied instantly and saved to the server. Study, assistant, AI & privacy and data sections arrive in T1.25.

import { useEffect, useState } from 'react';
import { SegmentedControl, Select, Slider, Switch } from '../ds/index.ts';
import { READING_LIMITS, type ReadingFont, type ThemePref } from '../../shared/settings.ts';
import { resolveTheme, readOsScheme } from '../theme.ts';
import { updateSettings, useSettings, type SaveState } from '../settingsStore.ts';
import { StylePicker } from './StylePicker.tsx';

const FONT_OPTIONS: ReadonlyArray<{ value: ReadingFont; label: string }> = [
  { value: 'style', label: "Style default" },
  { value: 'literata', label: 'Literata (serif)' },
  { value: 'inter', label: 'Inter (sans-serif)' },
  { value: 'atkinson', label: 'Atkinson Hyperlegible' },
  { value: 'opendyslexic', label: 'OpenDyslexic' },
];

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Saved',
  offline: "Saved on this device. Your account can't be reached right now.",
  error: "Couldn't save. Your change is kept on this device.",
};

export function SettingsPage() {
  const { settings, save } = useSettings();
  const [email, setEmail] = useState<string | null>(null);
  const r = settings.reading;
  const previewTheme = resolveTheme(settings.style, settings.theme, readOsScheme());

  useEffect(() => {
    fetch('/api/me')
      .then((res) => (res.ok ? (res.json() as Promise<{ email?: string }>) : null))
      .then((me) => setEmail(me?.email ?? null))
      .catch(() => setEmail(null));
  }, []);

  const setReading = (patch: Record<string, unknown>) => void updateSettings({ reading: patch });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-2">
        <h1 className="text-[2.125rem] leading-tight font-semibold">Settings</h1>
        <p role="status" aria-live="polite" className="min-h-6 text-sm text-text-2">
          {SAVE_TEXT[save]}
        </p>
      </div>

      <section aria-labelledby="appearance-heading" className="flex flex-col gap-6">
        <h2 id="appearance-heading" className="text-xl font-semibold">
          Appearance
        </h2>
        <div className="flex flex-col gap-3">
          <span id="style-label" className="text-text">
            Style
          </span>
          <StylePicker value={settings.style} theme={previewTheme} onChange={(style) => void updateSettings({ style })} />
        </div>
        <SegmentedControl<ThemePref>
          label="Theme"
          value={settings.theme}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={(theme) => void updateSettings({ theme })}
        />
      </section>

      <section aria-labelledby="reading-heading" className="flex flex-col gap-6">
        <h2 id="reading-heading" className="text-xl font-semibold">
          Reading
        </h2>
        <Select<ReadingFont> label="Reading font" value={r.font} options={FONT_OPTIONS} onChange={(font) => setReading({ font })} />
        <Slider
          label="Text size"
          value={r.sizePct}
          {...READING_LIMITS.sizePct}
          format={(v) => `${v}%`}
          onChange={(sizePct) => setReading({ sizePct })}
        />
        <Slider
          label="Letter spacing"
          value={r.letterSpacingEm}
          {...READING_LIMITS.letterSpacingEm}
          format={(v) => (v === 0 ? 'Normal' : `+${v.toFixed(2)} em`)}
          onChange={(letterSpacingEm) => setReading({ letterSpacingEm })}
        />
        <Slider
          label="Line spacing"
          value={r.lineHeight}
          {...READING_LIMITS.lineHeight}
          format={(v) => v.toFixed(2)}
          onChange={(lineHeight) => setReading({ lineHeight })}
        />
        <Slider
          label="Reading width"
          value={r.widthCh}
          {...READING_LIMITS.widthCh}
          format={(v) => `${v} characters`}
          onChange={(widthCh) => setReading({ widthCh })}
        />
        <div className="rounded-md border border-border bg-surface p-4">
          <p className="mb-2 text-sm text-text-3">Preview</p>
          <p className="reading">
            Entropy is a measure of how energy spreads out. Studypoint shows text from your sources in this reading style, with
            citations you can open at the exact page.
          </p>
        </div>
      </section>

      <section aria-labelledby="motion-heading" className="flex flex-col gap-6">
        <h2 id="motion-heading" className="text-xl font-semibold">
          Motion and keyboard
        </h2>
        <Switch
          label="Reduce motion"
          description="Turns off animations such as the card flip. Your system's reduced-motion setting is always respected too."
          checked={r.reduceMotion}
          onChange={(reduceMotion) => setReading({ reduceMotion })}
        />
        <Switch
          label="Single-key shortcuts"
          description="Keys like 1–4 to rate cards and / to search. Turn off if you use speech input or press keys by accident."
          checked={r.shortcuts}
          onChange={(shortcuts) => setReading({ shortcuts })}
        />
      </section>

      <section aria-labelledby="account-heading" className="flex flex-col gap-2">
        <h2 id="account-heading" className="text-xl font-semibold">
          Account
        </h2>
        <p className="text-text-2">{email ? `Signed in as ${email}.` : "Sign-in details aren't available yet."}</p>
      </section>
    </div>
  );
}
