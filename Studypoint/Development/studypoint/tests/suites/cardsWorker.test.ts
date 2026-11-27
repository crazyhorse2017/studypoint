// CRD-01 / AUTH-08 card storage in the Worker: only ciphertext, sides must match the card type, a course is
// required, and editing keeps the schedule of sides that stay (new sides start fresh, removed ones go).
// (Scheduling itself uses ts-fsrs, which the local harness can't load; CI covers submitReview.)

import { encryptText, importDataKey, randomBytes } from '../../src/shared/crypto/vault.ts';
import { uuid7 } from '../../src/shared/uuid7.ts';
import { CardError, createCard, updateCard } from '../../src/worker/cards.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

function fakeDb() {
  const cards = new Map<string, Record<string, unknown>>();
  const states = new Map<string, Record<string, unknown>>(); // key card:variant
  const stmt = (sql: string, a: unknown[] = []) => ({
    sql, a,
    bind: (...args: unknown[]) => stmt(sql, args),
    async first() {
      if (sql.startsWith('SELECT id FROM courses')) return a[0] === 'c1' && a[1] === 'u1' ? { id: 'c1' } : null;
      if (sql.startsWith('SELECT id FROM cards WHERE id')) return cards.has(a[0] as string) ? { id: a[0] } : null;
      if (sql.includes('FROM cards c WHERE c.id = ?')) {
        const c = cards.get(a[0] as string);
        if (!c || c['user_id'] !== a[1]) return null;
        const v = [...states.keys()].filter((k) => k.startsWith(`${a[0]}:`)).map((k) => k.split(':').slice(1).join(':'));
        return { ...c, variants: v.join(',') };
      }
      throw new Error('unexpected first: ' + sql);
    },
  });
  const db = {
    prepare: (sql: string) => stmt(sql),
    async batch(list: Array<{ sql: string; a: unknown[] }>) {
      for (const { sql, a } of list) {
        if (sql.startsWith('INSERT INTO cards')) cards.set(a[0] as string, { id: a[0], user_id: a[1], course_id: a[2], type: a[3], front_md: a[4], created_at: a[6], updated_at: a[7] });
        else if (sql.startsWith('INSERT INTO card_states')) states.set(`${a[0]}:${a[1]}`, { state: 'new' });
        else if (sql.startsWith('UPDATE cards SET front_md')) Object.assign(cards.get(a[4] as string) as object, { front_md: a[0] });
        else if (sql.startsWith('DELETE FROM card_states')) states.delete(`${a[0]}:${a[1]}`);
        else throw new Error('unexpected batch: ' + sql);
      }
      return [];
    },
  } as unknown as D1Database;
  return { db, cards, states };
}

async function sealed(id: string) {
  const k = await importDataKey(randomBytes(32));
  return encryptText(k, '{"type":"basic"}', `${id}#card`);
}

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 0; } catch (e) { return e instanceof CardError ? e.status : -1; }
}

export function register(test: TestFn, assert: Assert): void {
  test('cards (worker): plaintext, mismatched sides, unknown types and missing courses are refused', async () => {
    const { db, cards } = fakeDb();
    const id = uuid7();
    const payload = await sealed(id);
    assert.equal(await status(createCard(db, 'u1', { id, courseId: 'c1', type: 'basic', payload: '{"front":"x"}', variants: ['main'] })), 400, 'plaintext');
    assert.equal(await status(createCard(db, 'u1', { id, courseId: 'c1', type: 'basic', payload, variants: ['c1'] })), 400, 'cloze side on a basic card');
    assert.equal(await status(createCard(db, 'u1', { id, courseId: 'c1', type: 'occlusion', payload, variants: ['main'] })), 400);
    assert.equal(await status(createCard(db, 'u1', { id, courseId: 'c1', type: 'quiz', payload, variants: ['main'] })), 400);
    assert.equal(await status(createCard(db, 'u1', { id, courseId: 'cX', type: 'basic', payload, variants: ['main'] })), 400, 'not your course');
    assert.equal(await status(createCard(db, 'u1', { id, courseId: 'c1', type: 'basic', payload, variants: ['main', 'main'] })), 400, 'duplicate sides');
    assert.equal(cards.size, 0);
  });

  test('cards (worker): each side gets its own schedule; editing keeps kept sides, adds new, drops removed', async () => {
    const { db, states } = fakeDb();
    const id = uuid7();
    const payload = await sealed(id);
    await createCard(db, 'u1', { id, courseId: 'c1', type: 'cloze', payload, variants: ['c1', 'c2'] });
    assert.deepEqual([...states.keys()].sort(), [`${id}:c1`, `${id}:c2`]);
    (states.get(`${id}:c1`) as Record<string, unknown>)['state'] = 'review'; // c1 has been studied
    const info = await updateCard(db, 'u1', id, { payload, variants: ['c1', 'c3'] });
    assert.deepEqual(info.variants, ['c1', 'c3']);
    assert.equal(states.get(`${id}:c1`)?.['state'], 'review', 'kept side keeps its schedule');
    assert.ok(states.has(`${id}:c3`) && !states.has(`${id}:c2`));
    assert.equal(await status(updateCard(db, 'u1', id, { type: 'basic', payload, variants: ['main'] })), 400, 'type can’t change');
    assert.equal(await status(updateCard(db, 'u2', id, { payload, variants: ['c1'] })), 404, 'another account');
  });
}
