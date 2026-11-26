import { MAX_VISIBLE_TOASTS, dismissToast, pushToast, toastDuration, type Toast } from '../../src/client/ds/toastQueue.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void };

export function register(test: TestFn, assert: Assert): void {
  test('toast: durations: errors stay until dismissed, actions get longer', () => {
    assert.equal(toastDuration({ message: 'Saved' }), 5000);
    assert.equal(toastDuration({ message: 'Deleted', action: { label: 'Undo', onAction: () => {} } }), 8000);
    assert.equal(toastDuration({ message: 'Failed', tone: 'error' }), 0);
    assert.equal(toastDuration({ message: 'x', durationMs: -5 }), 0);
  });

  test('toast: queue keeps at most 3 and replaces identical messages', () => {
    let q: Toast[] = [];
    for (let i = 1; i <= 5; i += 1) q = pushToast(q, { message: `m${i}` }, i);
    assert.equal(q.length, MAX_VISIBLE_TOASTS);
    assert.equal(q[0]?.message, 'm3');
    q = pushToast(q, { message: 'm4' }, 99);
    assert.equal(q.filter((t) => t.message === 'm4').length, 1);
    assert.equal(q[q.length - 1]?.id, 99);
    q = dismissToast(q, 99);
    assert.ok(!q.some((t) => t.id === 99));
  });
}
