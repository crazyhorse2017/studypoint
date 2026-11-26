// Toast queue logic (pure, unit-tested). The React provider in Toast.tsx renders it.

export type ToastTone = 'info' | 'success' | 'error';

export type ToastInput = {
  message: string;
  tone?: ToastTone;
  /** Optional single action, e.g. Undo (DESIGN §5: prefer undo toasts for reversible actions). */
  action?: { label: string; onAction: () => void };
  /** ms; errors and toasts with an action stay longer. 0 = stays until dismissed. */
  durationMs?: number;
};

export type Toast = Required<Pick<ToastInput, 'message' | 'tone'>> & Pick<ToastInput, 'action'> & { id: number; durationMs: number };

export const MAX_VISIBLE_TOASTS = 3;

/** Defaults: 5 s info/success, 8 s when there's an action, errors stay until dismissed. */
export function toastDuration(input: ToastInput): number {
  if (input.durationMs !== undefined) return Math.max(0, input.durationMs);
  if ((input.tone ?? 'info') === 'error') return 0;
  return input.action ? 8000 : 5000;
}

export function pushToast(queue: readonly Toast[], input: ToastInput, id: number): Toast[] {
  const toast: Toast = { id, message: input.message, tone: input.tone ?? 'info', action: input.action, durationMs: toastDuration(input) };
  // Identical message already showing: replace it instead of stacking duplicates.
  const rest = queue.filter((t) => t.message !== toast.message);
  return [...rest, toast].slice(-MAX_VISIBLE_TOASTS);
}

export function dismissToast(queue: readonly Toast[], id: number): Toast[] {
  return queue.filter((t) => t.id !== id);
}
