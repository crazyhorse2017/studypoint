// Settings persistence (UX-01/03/06, T0.20). Validation is the shared, pure model in src/shared/settings.ts.

import { DEFAULT_APPEARANCE, mergeAppearance, normaliseReading, type AppearanceSettings } from '../shared/settings.ts';

type SettingsRow = { style: string; theme: string; reading_json: string };

export function rowToAppearance(row: SettingsRow | null): AppearanceSettings {
  if (!row) return DEFAULT_APPEARANCE;
  let reading: unknown = {};
  try {
    reading = JSON.parse(row.reading_json);
  } catch {
    reading = {};
  }
  // mergeAppearance validates style/theme against the allowed lists; reading is normalised field by field.
  return mergeAppearance(DEFAULT_APPEARANCE, { style: row.style, theme: row.theme, reading: normaliseReading(reading) });
}

export async function getAppearance(db: D1Database, userId: string): Promise<AppearanceSettings> {
  const row = await db.prepare('SELECT style, theme, reading_json FROM settings WHERE user_id = ?').bind(userId).first<SettingsRow>();
  return rowToAppearance(row);
}

export async function patchAppearance(db: D1Database, userId: string, patch: unknown, now = Date.now()): Promise<AppearanceSettings> {
  const next = mergeAppearance(await getAppearance(db, userId), patch);
  await db
    .prepare(
      `INSERT INTO settings (user_id, style, theme, reading_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(user_id) DO UPDATE SET style = ?2, theme = ?3, reading_json = ?4, updated_at = ?5`,
    )
    .bind(userId, next.style, next.theme, JSON.stringify(next.reading), now)
    .run();
  return next;
}
