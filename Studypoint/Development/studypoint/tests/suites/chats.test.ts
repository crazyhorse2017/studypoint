// Step 6a: streamed answers, saved conversations and citation previews (AST-01/02/06, LIB-09, AUTH-08).
// - The SSE reader takes the answer text from both Workers AI stream shapes at any split, and drops reasoning.
// - The streaming verifier gives the same answer as verifying it whole, and only ever shows complete,
//   already-checked sentences.
// - The Worker's stream route sends newline-delimited JSON, and an error line when the AI gives nothing.
// - Saved conversations refuse plaintext, other users' rows and oversized batches.
// - Quote highlighting finds the text-layer pieces a quote covers.

import { createAnswerVerifier, verifyAnswer } from '../../src/shared/answer.ts';
import { createSseTextReader, deltaText, parseAnswerStreamLine } from '../../src/shared/sseText.ts';
import { fileTarget, piecesForQuote, quoteWindow } from '../../src/shared/quoteSpans.ts';
import { encryptText, importDataKey, randomBytes } from '../../src/shared/crypto/vault.ts';
import { uuid7 } from '../../src/shared/uuid7.ts';
import { ConversationError, addMessages, createConversation, deleteConversation } from '../../src/worker/conversations.ts';
import { handleAnswerStream } from '../../src/worker/ai/handlers.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const P1 = 'Heat conduction through a plane wall follows Fourier’s law, where the heat flux is proportional to the temperature gradient.';
const P2 = 'Convection transfers heat between a surface and a moving fluid; Newton’s law of cooling gives q = hA(Ts - T∞).';
const passages = [{ ref: 'P1', text: P1, ocr: false }, { ref: 'P2', text: P2, ocr: false }];
const RAW = '<coverage>covered</coverage>Conduction follows Fourier’s law. ⟦P1: "heat flux is proportional to the temperature gradient"⟧ Convection is magic. ⟦P2: "convection is powered by magic dust"⟧ Cooling uses a film coefficient. ⟦P2: "Newton’s law of cooling gives q = hA(Ts - T∞)"⟧ <general>Heat always flows from hot to cold.</general>';

const sse = (events: unknown[]) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

function streamOf(text: string, size: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= bytes.length) return c.close();
      c.enqueue(bytes.slice(i, i + size));
      i += size;
    },
  });
}

async function readAll(res: Response): Promise<string> {
  return new TextDecoder().decode(new Uint8Array(await res.arrayBuffer()));
}

function fakeConvDb() {
  const convs = new Map<string, { user: string; course: string | null; title: string }>();
  const msgs: Array<{ id: string; conv: string; role: string }> = [];
  const stmt = (sql: string, a: unknown[] = []) => ({
    sql, a,
    bind: (...args: unknown[]) => stmt(sql, args),
    async first() {
      if (sql.startsWith('SELECT id FROM courses')) return a[0] === 'c1' && a[1] === 'u1' ? { id: 'c1' } : null;
      if (sql.startsWith('SELECT id FROM conversations')) {
        const c = convs.get(a[0] as string);
        return c && c.user === a[1] ? { id: a[0] } : null;
      }
      throw new Error('unexpected first: ' + sql);
    },
    async run() {
      if (sql.startsWith('INSERT INTO conversations')) convs.set(a[0] as string, { user: a[1] as string, course: a[2] as string | null, title: a[3] as string });
      else throw new Error('unexpected run: ' + sql);
      return { meta: { changes: 1 } };
    },
  });
  const db = {
    prepare: (sql: string) => stmt(sql),
    async batch(list: Array<{ sql: string; a: unknown[] }>) {
      for (const { sql, a } of list) {
        if (sql.startsWith('INSERT OR IGNORE INTO messages')) msgs.push({ id: a[0] as string, conv: a[1] as string, role: a[2] as string });
        else if (sql.startsWith('UPDATE conversations SET updated_at')) continue;
        else if (sql.startsWith('DELETE FROM messages')) msgs.splice(0, msgs.length, ...msgs.filter((m) => m.conv !== a[0]));
        else if (sql.startsWith('DELETE FROM conversations')) convs.delete(a[0] as string);
        else throw new Error('unexpected batch: ' + sql);
      }
      return [];
    },
  } as unknown as D1Database;
  return { db, convs, msgs };
}

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 0; } catch (e) { return e instanceof ConversationError ? e.status : -1; }
}

export function register(test: TestFn, assert: Assert): void {
  test('stream reader: both Workers AI shapes, split anywhere, reasoning dropped, [DONE] seen', () => {
    const raw = sse([
      { choices: [{ delta: { reasoning_content: 'Let me think about heat.' } }] },
      { choices: [{ delta: { content: 'Heat ' } }] },
      { choices: [{ delta: { content: 'flows.' } }] },
      { response: ' Down the gradient.' },
      { usage: { prompt_tokens: 10 } },
      '[DONE]',
    ]);
    for (let size = 1; size <= 40; size += 1) {
      const r = createSseTextReader();
      let out = '';
      for (let i = 0; i < raw.length; i += size) out += r.push(raw.slice(i, i + size));
      out += r.end();
      assert.equal(out, 'Heat flows. Down the gradient.', `chunk size ${size}`);
      assert.ok(r.done, 'saw [DONE]');
    }
    assert.equal(deltaText({ choices: [{ delta: { reasoning: 'hidden' } }] }), '');
    assert.equal(deltaText(null), '');
  });

  test('stream lines: text, done and error events; junk is ignored', () => {
    assert.deepEqual(parseAnswerStreamLine('{"t":"Hi"}'), { t: 'Hi' });
    assert.deepEqual(parseAnswerStreamLine('{"done":true,"promptVersion":"answer@2"}'), { done: true, promptVersion: 'answer@2' });
    assert.deepEqual(parseAnswerStreamLine('{"error":"No"}'), { error: 'No' });
    assert.equal(parseAnswerStreamLine('not json'), null);
    assert.equal(parseAnswerStreamLine('   '), null);
  });

  test('streaming verifier: same result as verifying whole, and only checked, complete sentences ever show', () => {
    const whole = verifyAnswer(RAW, passages);
    assert.deepEqual(whole.segments.map((s) => s.kind), ['sourced', 'unverified', 'sourced', 'general']);
    for (const size of [1, 2, 3, 5, 8, 13, 21, 64]) {
      const v = createAnswerVerifier(passages);
      let shown = 0;
      for (let i = 0; i < RAW.length; i += size) {
        const a = v.push(RAW.slice(i, i + size));
        assert.ok(a.segments.length >= shown, 'segments never disappear');
        shown = a.segments.length;
        for (const s of a.segments) {
          if (s.kind === 'sourced') assert.ok(s.citations.every((c) => c.verified), 'a sourced sentence shows only verified citations');
          assert.ok(!/⟦|⟧|<general>|<coverage>/.test(s.text), 'no raw markers reach the screen');
        }
      }
      assert.deepEqual(v.end(), whole, `chunk size ${size}`);
    }
  });

  test('answer stream route: NDJSON text lines then done; an empty reply ends with an error line', async () => {
    const reply = sse([{ choices: [{ delta: { reasoning_content: 'thinking' } }] }, { choices: [{ delta: { content: '<coverage>covered</coverage>Heat ' } }] }, { choices: [{ delta: { content: 'flows.' } }] }, '[DONE]']);
    const env = (body: () => unknown) => ({ AI: { run: async () => body() } as unknown as Ai, AI_MODELS: '{"answer":"m"}' });
    const req = { question: 'Why does heat flow?', passages: [{ ref: 'P1', text: P1 }] };
    const res = await handleAnswerStream(env(() => streamOf(reply, 7)), 'u1', req);
    assert.ok((res.headers.get('Content-Type') ?? '').startsWith('application/x-ndjson'));
    const lines = (await readAll(res)).trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
    assert.equal(lines.filter((l) => typeof l['t'] === 'string').map((l) => l['t']).join(''), '<coverage>covered</coverage>Heat flows.');
    assert.equal(lines[lines.length - 1]?.['done'], true);
    assert.ok(!JSON.stringify(lines).includes('thinking'), 'reasoning never reaches the browser');

    const empty = await handleAnswerStream(env(() => streamOf(sse([{ choices: [{ delta: { reasoning_content: 'only thinking' } }] }, '[DONE]']), 5)), 'u1', req);
    const last = JSON.parse((await readAll(empty)).trim().split('\n').pop() ?? '{}') as Record<string, unknown>;
    assert.ok(typeof last['error'] === 'string', 'an empty reply is reported, not left blank');

    const whole = await handleAnswerStream(env(() => ({ response: 'Not streamed.' })), 'u1', req);
    assert.ok((await readAll(whole)).includes('"t":"Not streamed."'), 'a non-streamed reply still comes through');
  });

  test('conversations (worker): ciphertext only, own course and rows only, 1–2 messages per call', async () => {
    const { db, msgs, convs } = fakeConvDb();
    const k = await importDataKey(randomBytes(32));
    const id = uuid7();
    const title = await encryptText(k, 'Fourier', `${id}#title`);
    assert.equal(await status(createConversation(db, 'u1', { id, courseId: 'c1', mode: 'direct', title: 'Fourier' })), 400, 'plaintext title');
    assert.equal(await status(createConversation(db, 'u1', { id, courseId: 'c9', mode: 'direct', title })), 400, 'someone else’s course');
    assert.equal(await status(createConversation(db, 'u1', { id: 'nope', courseId: 'c1', title })), 400, 'bad id');
    const c = await createConversation(db, 'u1', { id, courseId: 'c1', mode: 'tutor', title });
    assert.equal(c.mode, 'tutor');
    const m = async (role: string) => {
      const mid = uuid7();
      return { id: mid, role, content: await encryptText(k, 'x', `${mid}#msg`) };
    };
    assert.equal(await status(addMessages(db, 'u1', id, { messages: [{ id: uuid7(), role: 'user', content: 'plain question' }] })), 400, 'plaintext message');
    assert.equal(await status(addMessages(db, 'u1', id, { messages: [await m('user'), await m('assistant'), await m('user')] })), 400, 'three at once');
    assert.equal(await status(addMessages(db, 'u1', id, { messages: [await m('system')] })), 400, 'unknown role');
    assert.equal(await status(addMessages(db, 'u2', id, { messages: [await m('user')] })), 404, 'another user’s conversation');
    assert.equal((await addMessages(db, 'u1', id, { messages: [await m('user'), await m('assistant')] })).added, 2);
    assert.equal(msgs.length, 2);
    assert.equal(await deleteConversation(db, 'u2', id), false, 'another user can’t delete it');
    assert.equal(await deleteConversation(db, 'u1', id), true);
    assert.equal(msgs.length, 0, 'its messages go too');
    assert.equal(convs.size, 0);
  });

  test('citation preview + highlight: quote found across text-layer pieces; links parsed; misses are empty', () => {
    const pieces = ['Heat conduction through a plane wall follows Fourier’s law, where the ', 'heat flux is proportional', ' to the temperature', 'gradient.', 'Page 4'];
    assert.deepEqual(piecesForQuote(pieces, 'heat flux is proportional to the temperature gradient'), [1, 2, 3]);
    assert.deepEqual(piecesForQuote(pieces, 'follows Fourier’s law, where the heat flux is proportional'), [0, 1]);
    assert.deepEqual(piecesForQuote(pieces, 'entropy always increases in an isolated system'), []);
    assert.deepEqual(fileTarget('/files/abc?page=12'), { sourceId: 'abc', page: 12 });
    assert.deepEqual(fileTarget('/files/abc'), { sourceId: 'abc', page: null });
    assert.equal(fileTarget('/notes/abc'), null);
    const w = quoteWindow(P1, 'heat flux is proportional to the temperature gradient', false, 10);
    assert.ok(w !== null && w.match === 'heat flux is proportional to the temperature gradient' && w.before.startsWith('…'));
    assert.equal(quoteWindow(P1, 'nothing like this is in the passage at all', false), null);
  });
}
