// A Mermaid diagram (AI-made study materials, step 5). Mermaid loads only when a diagram is shown, runs in
// strict security mode, and its SVG is displayed as an <img> (an image can't run scripts), so even a
// malicious diagram definition can't touch the page. If the definition doesn't parse, the code is shown.

import { useEffect, useState } from 'react';

let seq = 0;

function toDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

export function Diagram({ code, caption }: { code: string; caption?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null);
    setFailed(false);
    void (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const dark = document.documentElement.dataset['theme'] === 'dark';
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral', htmlLabels: false, flowchart: { htmlLabels: false } });
        const { svg } = await mermaid.render(`sf-diagram-${(seq += 1)}`, code);
        if (live) setSrc(toDataUrl(svg));
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [code]);
  return (
    <figure className="my-4 flex flex-col items-center gap-2">
      {src ? (
        <img src={src} alt={caption ? `Diagram: ${caption}` : 'Diagram'} className="max-w-full rounded-md border border-border bg-surface p-3" />
      ) : failed ? (
        <pre className="w-full overflow-x-auto rounded-md bg-sunken p-3 text-sm"><code>{code}</code></pre>
      ) : (
        <p className="text-sm text-text-2">Drawing the diagram…</p>
      )}
      {caption ? <figcaption className="text-center text-sm text-text-2">{caption}</figcaption> : null}
    </figure>
  );
}
