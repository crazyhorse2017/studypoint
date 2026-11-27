// Card text with Word-style math (LIB-08 convention, Alex's LaTeX reference): any backslash command with
// its arguments and scripts ("\frac{a}{b}", "\alpha", "\sum_{i=1}^{n}") is math; everything else is
// text. No $ delimiters. Pure: splits text into segments; the client renders the math ones with KaTeX.

const GROUP = String.raw`\{(?:[^{}\n]|\{(?:[^{}\n]|\{[^{}\n]*\})*\})*\}`;
const COMMAND = String.raw`\\[A-Za-z]+(?:${GROUP}|\[[^\]\n]*\]|[_^](?:${GROUP}|[A-Za-z0-9]))*`;
/** A math run: one command, or several joined by spaces or a single operator ("\cdot \gamma", "\alpha + \beta"). */
const MATH_RUN = new RegExp(String.raw`${COMMAND}(?:\s*[=+\-*/<>,]?\s*${COMMAND})*`, 'g');

export type Segment = { math: false; text: string } | { math: true; latex: string };

export function splitMath(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(MATH_RUN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ math: false, text: text.slice(last, at) });
    out.push({ math: true, latex: m[0].trim() });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ math: false, text: text.slice(last) });
  return out.filter((s) => (s.math ? s.latex !== '' : s.text !== ''));
}
