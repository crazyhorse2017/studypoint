import { API_SECURITY_HEADERS, apiError, json } from '../../src/worker/http.ts';
import { APP_VERSION, handleApi } from '../../src/worker/index.ts';

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

  test('api: GET /api/health reports ok and the app version', async () => {
    const res = await handleApi(new Request('https://studypoint.example/api/health'));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok', service: 'studypoint', version: APP_VERSION });
  });

  test('api: POST /api/health is rejected with 405', async () => {
    const res = await handleApi(new Request('https://studypoint.example/api/health', { method: 'POST' }));
    assert.equal(res.status, 405);
  });

  test('api: unknown routes return a JSON 404', async () => {
    const res = await handleApi(new Request('https://studypoint.example/api/nope'));
    assert.equal(res.status, 404);
    assert.equal(res.headers.get('Content-Type'), 'application/json; charset=utf-8');
  });
}
