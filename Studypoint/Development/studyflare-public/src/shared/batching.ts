// Splitting AI generation into parallel batches (step 6b). Pure. One big request makes the model write
// (and think about) every item in turn: about 70 s for 8 questions. Batches of up to BATCH items run AT
// THE SAME TIME, each with its own share of the passages, so they don't write the same items.

export const BATCH = 5;

/** Split `count` items into batches of at most BATCH, each with a round-robin share of the passages. */
export function batchPlan(count: number, passages: number): Array<{ count: number; passageIdx: number[] }> {
  const n = Math.max(1, Math.ceil(count / BATCH));
  const out: Array<{ count: number; passageIdx: number[] }> = [];
  for (let b = 0; b < n; b += 1) {
    // With too few passages to give each batch at least two, every batch gets all of them.
    const share = Array.from({ length: passages }, (_, i) => i).filter((i) => passages < 2 * n || i % n === b);
    out.push({ count: Math.ceil((count - b) / n), passageIdx: share });
  }
  return out.filter((b) => b.count > 0);
}

/** Run `fn` over items with at most `limit` at once, keeping the order. */
export async function inParallel<T, R>(items: readonly T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
