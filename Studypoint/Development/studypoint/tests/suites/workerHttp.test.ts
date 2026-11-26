import { API_SECURITY_HEADERS, apiError, json } from '../../src/worker/http.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = {
  ok(cond: unknown, msg?: string): void;
  equal(a: unknown, b: unknown, msg?: string): void;
  deepEqual(a: unknown, b: unknown, msg?: string): void;
};

export function register(test: TestFn, assert: Assert): void {
  test('http: json() sets status and every security header', async () => {
    const res = json({ a: 1 }, 201);
    assert.equal(res.status, 201);
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      assert.equal(res.headers.get(name), value, `Header ${name}`);
    }
    assert.deepEqual(await res.json(), { a: 1 });
  });

  test('http: apiError() uses the standard error shape', async () => {
    const res = apiError(404, 'not_found', 'Nope.');
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: { code: 'not_found', message: 'Nope.' } });
  });
}
