// Nightly backup naming and retention (EXP-02, ARCHITECTURE §3.5). Pure.
// One backup per account per day at backups/<userId>/<YYYY-MM-DD>.json.gz. For EACH account, keep the last
// 30 daily backups plus the first backup of each of the last 12 months.

export const BACKUP_PREFIX = 'backups/';
const KEY_RE = /^backups\/([A-Za-z0-9-]+)\/(\d{4})-(\d{2})-(\d{2})\.json\.gz$/;

export function backupKey(date: Date, userId: string): string {
  if (!/^[A-Za-z0-9-]+$/.test(userId)) throw new Error('Invalid user id for a backup key');
  return `${BACKUP_PREFIX}${userId}/${date.toISOString().slice(0, 10)}.json.gz`;
}

/** Which backup keys to delete. Keys that don't match the naming scheme are never touched. */
export function backupsToDelete(keys: readonly string[], keepDaily = 30, keepMonthly = 12): string[] {
  const byUser = new Map<string, Array<{ key: string; day: string; month: string }>>();
  for (const key of keys) {
    const m = KEY_RE.exec(key);
    if (!m) continue;
    const list = byUser.get(m[1] as string) ?? [];
    list.push({ key, day: `${m[2]}-${m[3]}-${m[4]}`, month: `${m[2]}-${m[3]}` });
    byUser.set(m[1] as string, list);
  }
  const doomed: string[] = [];
  for (const list of byUser.values()) {
    const dated = [...list].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)); // newest first
    const keep = new Set<string>(dated.slice(0, keepDaily).map((d) => d.key));
    const firstOfMonth = new Map<string, string>();
    for (const d of [...dated].reverse()) if (!firstOfMonth.has(d.month)) firstOfMonth.set(d.month, d.key);
    for (const month of [...firstOfMonth.keys()].sort().reverse().slice(0, keepMonthly)) keep.add(firstOfMonth.get(month) as string);
    for (const d of dated) if (!keep.has(d.key)) doomed.push(d.key);
  }
  return doomed;
}
