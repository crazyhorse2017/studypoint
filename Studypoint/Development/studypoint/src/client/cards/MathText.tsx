// Renders card text with Word-style math: backslash commands become KaTeX (MathML included for screen
// readers); everything else is plain text with line breaks kept. No HTML from the text is ever injected;
// only KaTeX's own output (trust: false) is.

import katex from 'katex';
import 'katex/dist/katex.min.css';
import { splitMath } from '../../shared/mathText.ts';

function MathSpan({ latex, display }: { latex: string; display: boolean }) {
  let html: string;
  try {
    html = katex.renderToString(latex, { throwOnError: true, trust: false, output: 'htmlAndMathml', displayMode: display });
  } catch {
    return <code className="font-mono text-[0.95em]">{latex}</code>; // not valid LaTeX: show it as typed
  }
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Text with inline math. If the whole text is one formula, it's shown centred and large. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const segs = splitMath(text);
  const only = segs.length === 1 && segs[0]?.math === true;
  return (
    <span className={`whitespace-pre-wrap ${className ?? ''}`}>
      {segs.map((s, i) => (s.math ? <MathSpan key={i} latex={s.latex} display={only} /> : <span key={i}>{s.text}</span>))}
    </span>
  );
}

/** Raw LaTeX (cloze answers, the math box): always math. */
export function Latex({ latex, display = false }: { latex: string; display?: boolean }) {
  return <MathSpan latex={latex} display={display} />;
}
