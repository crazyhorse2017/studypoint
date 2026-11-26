import { isUuid7, resetUuid7StateForTests, uuid7, uuid7Timestamp } from '../../src/shared/uuid7.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = {
  ok(cond: unknown, msg?: string): void;
  equal(a: unknown, b: unknown, msg?: string): void;
  notEqual(a: unknown, b: unknown, msg?: string): void;
  throws(fn: () => unknown, msg?: string): void;
};

export function register(test: TestFn, assert: Assert): void {
  test('uuid7: format is a lowercase RFC 9562 v7 UUID', () => {
    resetUuid7StateForTests();
    for (let i = 0; i < 200; i += 1) {
      const id = uuid7();
      assert.ok(isUuid7(id), `Not a valid UUIDv7: ${id}`);
      assert.equal(id.length, 36);
    }
  });

  test('uuid7: embeds the given timestamp', () => {
    resetUuid7StateForTests();
    const ms = Date.UTC(2026, 10, 26, 12, 0, 0);
    assert.equal(uuid7Timestamp(uuid7(ms)), ms);
  });

  test('uuid7: IDs made in the same millisecond still sort in creation order', () => {
    resetUuid7StateForTests();
    const ms = Date.UTC(2027, 0, 15);
    const ids = Array.from({ length: 2000 }, () => uuid7(ms));
    const sorted = [...ids].sort();
    assert.equal(sorted.join(), ids.join(), 'Lexicographic order should match creation order');
    assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  });

  test('uuid7: ordering survives the clock going backwards', () => {
    resetUuid7StateForTests();
    const a = uuid7(Date.UTC(2027, 0, 15, 10));
    const b = uuid7(Date.UTC(2027, 0, 15, 9)); // clock moved back an hour
    assert.ok(b > a, 'Later ID must still sort after the earlier one');
  });

  test('uuid7: increasing timestamps sort in order', () => {
    resetUuid7StateForTests();
    const a = uuid7(1_000_000);
    const b = uuid7(1_000_001);
    assert.ok(a < b);
  });

  test('uuid7: rejects non-v7 strings', () => {
    assert.ok(!isUuid7('6fa459ea-ee8a-3ca4-894e-db77e160355e'), 'v3 UUID accepted');
    assert.ok(!isUuid7('01890A5D-AC96-774B-BCCE-B302099A8057'), 'Uppercase accepted');
    assert.ok(!isUuid7('not-a-uuid'));
    assert.throws(() => uuid7Timestamp('not-a-uuid'));
  });
}
