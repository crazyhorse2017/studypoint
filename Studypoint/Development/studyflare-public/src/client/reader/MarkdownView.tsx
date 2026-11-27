// Imported web pages and .md files in the Reader. Parsed by shared/markdown.ts and rendered here as React
// elements, so nothing from the page can run or inject HTML. Links open in a new tab without a referrer.

import { useMemo } from 'react';
import { parseMarkdown, type Inline } from '../../shared/markdown.ts';

function Inlines({ items }: { items: readonly Inline[] }) {
  return (
    <>
      {items.map((it, i) => {
        switch (it.kind) {
          case 'bold':
            return <strong key={i}>{it.text}</strong>;
          case 'italic':
            return <em key={i}>{it.text}</em>;
          case 'code':
            return <code key={i}>{it.text}</code>;
          case 'link':
            return (
              <a key={i} href={it.href} target="_blank" rel="noopener noreferrer">
                {it.text}
              </a>
            );
          default:
            return <span key={i}>{it.text}</span>;
        }
      })}
    </>
  );
}

export function MarkdownView({ text }: { text: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <article className="reading doc-view note-body mx-auto flex flex-col">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading': {
            const H = (['h2', 'h2', 'h3', 'h4', 'h4', 'h4'] as const)[b.level - 1] ?? 'h4';
            return <H key={i}><Inlines items={b.inline} /></H>;
          }
          case 'para':
            return <p key={i}><Inlines items={b.inline} /></p>;
          case 'quote':
            return <blockquote key={i}><Inlines items={b.inline} /></blockquote>;
          case 'code':
            return <pre key={i}><code>{b.text}</code></pre>;
          case 'rule':
            return <hr key={i} className="border-border" />;
          case 'list': {
            const items = b.items.map((it, j) => <li key={j} style={{ marginLeft: `${it.level * 1.5}em` }}><Inlines items={it.inline} /></li>);
            return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
          }
          case 'table':
            return (
              <div key={i} className="overflow-x-auto">
                <table>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>{row.map((cell, c) => <td key={c}><Inlines items={cell} /></td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </article>
  );
}
