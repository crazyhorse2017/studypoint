// Reading a streamed Workers AI reply (step 6a, AST-01). Pure. Workers AI streams Server-Sent Events whose
// `data:` lines are JSON in one of two shapes: classic `{"response":"…"}` or chat completions
// `{"choices":[{"delta":{"content":"…"}}]}`. Reasoning models also stream their thinking
// (`delta.reasoning_content` / `delta.reasoning`); that's never part of the answer, so it's dropped.
// Chunks can split anywhere, even mid-line, so lines are buffered until complete.

export type SseTextReader = {
  /** Feed raw text from the stream; returns the answer text found in the complete lines so far. */
  push(chunk: string): string;
  /** Flush a final line with no trailing newline. */
  end(): string;
  /** True once `data: [DONE]` was seen. */
  readonly done: boolean;
};

/** The answer text in one parsed `data:` payload (empty for reasoning, usage and other events). */
export function deltaText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  if (typeof p['response'] === 'string') return p['response'];
  const choices = p['choices'];
  if (Array.isArray(choices) && choices.length > 0) {
    const c = (choices[0] ?? {}) as Record<string, unknown>;
    const delta = (c['delta'] ?? c['message']) as Record<string, unknown> | undefined;
    if (delta && typeof delta['content'] === 'string') return delta['content'];
    if (typeof c['text'] === 'string') return c['text'];
  }
  return '';
}

export function createSseTextReader(): SseTextReader {
  let buf = '';
  let done = false;
  const line = (raw: string): string => {
    const l = raw.replace(/\r$/, '');
    if (!l.startsWith('data:')) return '';
    const data = l.slice(5).trim();
    if (data === '[DONE]') {
      done = true;
      return '';
    }
    if (!data) return '';
    try {
      return deltaText(JSON.parse(data));
    } catch {
      return '';
    }
  };
  return {
    push(chunk: string) {
      buf += chunk;
      let out = '';
      let nl = buf.indexOf('\n');
      while (nl >= 0) {
        out += line(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        nl = buf.indexOf('\n');
      }
      return out;
    },
    end() {
      const rest = buf;
      buf = '';
      return rest ? line(rest) : '';
    },
    get done() {
      return done;
    },
  };
}

/**
 * The Worker → browser stream is newline-delimited JSON, one event per line:
 * `{"t":"…"}` answer text, `{"done":true,"promptVersion":"…"}` at the end, `{"error":"…"}` on failure.
 */
export type AnswerStreamEvent = { t: string } | { done: true; promptVersion: string } | { error: string };

export function parseAnswerStreamLine(line: string): AnswerStreamEvent | null {
  const l = line.trim();
  if (!l) return null;
  try {
    const o = JSON.parse(l) as Record<string, unknown>;
    if (typeof o['t'] === 'string') return { t: o['t'] };
    if (o['done'] === true) return { done: true, promptVersion: typeof o['promptVersion'] === 'string' ? o['promptVersion'] : '' };
    if (typeof o['error'] === 'string') return { error: o['error'] };
  } catch {
    return null;
  }
  return null;
}
