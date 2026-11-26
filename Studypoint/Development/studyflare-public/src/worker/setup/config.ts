// Deployment settings (AUTH-07). A one-click deploy leaves ACCESS_TEAM_DOMAIN and ACCESS_AUD as "todo";
// first-run setup then stores the real values in D1 (app_config). Values set in wrangler.jsonc always win,
// so a hand-configured deployment never reads the table.

import type { AuthEnv } from '../auth/policy.ts';
import type { PeopleEnv } from '../people.ts';

export type ConfigKey = 'team_domain' | 'aud' | 'account_id' | 'app_id' | 'policy_id' | 'brand_app_id' | 'setup_at';
export type StoredConfig = Partial<Record<ConfigKey, string>>;

const KEYS: readonly ConfigKey[] = ['team_domain', 'aud', 'account_id', 'app_id', 'policy_id', 'brand_app_id', 'setup_at'];

/** Empty, missing or the literal "todo" all mean "not set here". */
export function isPlaceholder(v: string | undefined): boolean {
  const t = (v ?? '').trim().toLowerCase();
  return t === '' || t === 'todo';
}

export async function readStoredConfig(db: D1Database): Promise<StoredConfig> {
  const rows = await db.prepare('SELECT key, value FROM app_config').all<{ key: string; value: string }>();
  const out: StoredConfig = {};
  for (const r of rows.results) if ((KEYS as readonly string[]).includes(r.key)) out[r.key as ConfigKey] = r.value;
  return out;
}

export async function writeStoredConfig(db: D1Database, values: StoredConfig, now = Date.now()): Promise<void> {
  const stmts: D1PreparedStatement[] = [];
  for (const key of KEYS) {
    const v = values[key];
    if (typeof v !== 'string') continue;
    stmts.push(db.prepare('INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, v, now));
  }
  if (stmts.length > 0) await db.batch(stmts);
}

type ConfigurableEnv = AuthEnv & PeopleEnv;

/** The env the rest of the app sees: wrangler values first, stored setup values where wrangler says "todo". */
export function effectiveEnv<E extends ConfigurableEnv>(env: E, stored: StoredConfig): E {
  const pick = (own: string | undefined, saved: string | undefined) => (isPlaceholder(own) ? saved : own);
  return {
    ...env,
    ACCESS_TEAM_DOMAIN: pick(env.ACCESS_TEAM_DOMAIN, stored.team_domain),
    ACCESS_AUD: pick(env.ACCESS_AUD, stored.aud),
    CF_ACCOUNT_ID: pick(env.CF_ACCOUNT_ID, stored.account_id),
    ACCESS_APP_ID: pick(env.ACCESS_APP_ID, stored.app_id),
    ACCESS_POLICY_ID: pick(env.ACCESS_POLICY_ID, stored.policy_id),
  };
}

/** True while sign-in can't work yet: the Access team domain or AUD is still unknown. */
export function needsSetup(env: ConfigurableEnv): boolean {
  return isPlaceholder(env.ACCESS_TEAM_DOMAIN) || isPlaceholder(env.ACCESS_AUD);
}
