// Nightly backup naming and retention (EXP-02, ARCHITECTURE §3.5): keep the last 30 daily backups
// plus the first backup of each of the last 12 months. Pure.

export const BACKUP_PREFIX = 'backups/';
const KEY_RE = /^backups\/(\d{4})-(\d{2})-(\d{2})\.json\.gz$/;

export function backupKey(date: Date): string {
  return `${BACKUP_PREFIX}${date.toISOString().slice(0, 10)}.json.gz`;
}

/** Which backup keys to delete. Keys that don't match the naming scheme are never touched. */
export function backupsToDelete(keys: readonly string[], keepDaily = 30, keepMonthly = 12): string[] {
  const dated = keys
    .flatMap((key) => {
      const m = KEY_RE.exec(key);
      return m ? [{ key, day: `${m[1]}-${m[2]}-${m[3]}`, month: `${m[1]}-${m[2]}` }] : [];
    })
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)); // newest first

  const keep = new Set<string>(dated.slice(0, keepDaily).map((d) => d.key));
  // The earliest backup within each month represents that month.
  const firstOfMonth = new Map<string, string>();
  for (const d of [...dated].reverse()) if (!firstOfMonth.has(d.month)) firstOfMonth.set(d.month, d.key);
  const months = [...firstOfMonth.keys()].sort().reverse().slice(0, keepMonthly);
  for (const month of months) keep.add(firstOfMonth.get(month) as string);

  return dated.filter((d) => !keep.has(d.key)).map((d) => d.key);
}
