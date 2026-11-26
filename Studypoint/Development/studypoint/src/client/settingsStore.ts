// Appearance settings on the client (UX-01/03). Applies instantly, caches in localStorage so the next
// load paints with the right style before the API answers, and saves to /api/settings.
// localStorage holds UI prefs only (ARCHITECTURE §4); the server copy is the source of truth.

import { useSyncExternalStore } from 'react';
import { DEFAULT_APPEARANCE, mergeAppearance, type AppearanceSettings } from '../shared/settings.ts';
import { applyAppearance, applyReading } from './theme.ts';

const CACHE_KEY = 'studypoint.appearance.v1';

export type SaveState = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

type State = { settings: AppearanceSettings; save: SaveState };

let state: State = { settings: readCache(), save: 'idle' };
const listeners = new Set<() => void>();

function readCache(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? mergeAppearance(DEFAULT_APPEARANCE, JSON.parse(raw)) : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

function setState(next: State) {
  state = next;
  apply(next.settings);
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(next.settings));
  } catch {
    // Storage full or blocked: the app still works, it just won't remember locally.
  }
  listeners.forEach((l) => l());
}

function apply(s: AppearanceSettings) {
  applyAppearance(s.style, s.theme);
  applyReading(s.reading);
}

/** Call once at startup: paint from cache, then load the server copy. */
export async function initSettings(): Promise<void> {
  apply(state.settings);
  // Follow OS light/dark changes while the theme is "system".
  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => apply(state.settings));
  }
  try {
    const res = await fetch('/api/settings', { headers: { Accept: 'application/json' } });
    if (res.ok) setState({ settings: mergeAppearance(DEFAULT_APPEARANCE, await res.json()), save: 'idle' });
    else setState({ ...state, save: res.status === 503 ? 'offline' : state.save });
  } catch {
    setState({ ...state, save: 'offline' });
  }
}

/** Optimistic update: applies immediately, then saves. Returns false if the server rejected or was unreachable. */
export async function updateSettings(patch: Record<string, unknown>): Promise<boolean> {
  const next = mergeAppearance(state.settings, patch);
  setState({ settings: next, save: 'saving' });
  try {
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setState({ ...state, save: res.status === 503 ? 'offline' : 'error' });
      return false;
    }
    setState({ settings: mergeAppearance(DEFAULT_APPEARANCE, await res.json()), save: 'saved' });
    return true;
  } catch {
    setState({ ...state, save: 'offline' });
    return false;
  }
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useSettings(): State {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
