// Toasts (DESIGN §5 "Overlays"): a polite live region for status, assertive for errors.
// Timers pause while the toast is hovered or focused (WCAG 2.2.1 Timing Adjustable).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cx } from './cx.ts';
import { dismissToast, pushToast, type Toast, type ToastInput } from './toastQueue.ts';

type ToastApi = { show: (input: ToastInput) => void; dismiss: (id: number) => void };

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setQueue((q) => dismissToast(q, id)), []);
  const show = useCallback((input: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    setQueue((q) => pushToast(q, input, id));
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  const polite = queue.filter((t) => t.tone !== 'error');
  const assertive = queue.filter((t) => t.tone === 'error');

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:px-6">
        <div role="status" aria-live="polite" className="contents">
          {polite.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
        <div role="alert" aria-live="assertive" className="contents">
          {assertive.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.durationMs);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    if (toast.durationMs === 0 || paused) return;
    startedAt.current = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [paused, toast.durationMs, toast.id, onDismiss]);

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className={cx(
        'pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-md border bg-surface px-4 py-3 text-text shadow-pop',
        toast.tone === 'error' ? 'border-danger' : toast.tone === 'success' ? 'border-success' : 'border-border',
      )}
    >
      <span className="flex-1 text-sm">
        {toast.tone === 'error' ? <span className="font-semibold text-danger">Error: </span> : null}
        {toast.message}
      </span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action?.onAction();
            onDismiss(toast.id);
          }}
          className="ds-target rounded-sm px-2 text-sm font-semibold text-accent hover:underline"
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
        className="ds-target inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-2 hover:bg-sunken"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
