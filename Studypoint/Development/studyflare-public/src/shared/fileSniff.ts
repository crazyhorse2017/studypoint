// What a file REALLY is, from its bytes (LIB-02, NFR-SEC). Uploads are encrypted in the browser
// (AUTH-08), so the Worker never sees plaintext: this check runs in the browser BEFORE encryption, and a
// renamed file (e.g. an .exe called notes.pdf, or an SVG called photo.png) is refused there.
// The Worker only accepts the four kinds below and a matching MIME type.

export type FileKind = 'pdf' | 'docx' | 'pptx' | 'image' | 'md';

export type Sniffed = { ok: true; kind: FileKind; mime: string } | { ok: false; reason: string };

export const KIND_MIME: Readonly<Record<string, FileKind>> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/webp': 'image',
  'text/markdown': 'md',
};

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

/** Finds an ASCII string anywhere in the bytes (ZIP entry names are stored uncompressed). */
function contains(b: Uint8Array, s: string): boolean {
  const needle = ascii(s);
  const first = needle[0] ?? 0;
  const matchesAt = (i: number) => needle.every((x, j) => b[i + j] === x);
  for (let i = b.indexOf(first); i !== -1 && i <= b.length - needle.length; i = b.indexOf(first, i + 1)) {
    if (matchesAt(i)) return true;
  }
  return false;
}

function looksLikeText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b);
    return true;
  } catch {
    return false;
  }
}

/**
 * Identify a file from its bytes. `name` is only used to tell Markdown from other text and to word the
 * error; the bytes decide everything else.
 */
export function sniffFile(bytes: Uint8Array, name: string): Sniffed {
  const lower = name.toLowerCase();
  if (startsWith(bytes, ascii('%PDF-'))) return { ok: true, kind: 'pdf', mime: 'application/pdf' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ok: true, kind: 'image', mime: 'image/png' };
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { ok: true, kind: 'image', mime: 'image/jpeg' };
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return { ok: true, kind: 'image', mime: 'image/webp' };
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (contains(bytes, 'word/document.xml')) return { ok: true, kind: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
    if (contains(bytes, 'ppt/presentation.xml')) return { ok: true, kind: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
    return { ok: false, reason: `${name} is a ZIP file but not a Word document or PowerPoint deck.` };
  }
  if (lower.endsWith('.md') && looksLikeText(bytes)) {
    const head = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
    if (head.startsWith('<svg') || head.startsWith('<?xml') || head.startsWith('<!doctype') || head.startsWith('<html')) {
      return { ok: false, reason: `${name} isn't Markdown (it looks like SVG or HTML, which isn't allowed).` };
    }
    return { ok: true, kind: 'md', mime: 'text/markdown' };
  }
  if (lower.endsWith('.heic') || lower.endsWith('.heif')) {
    return { ok: false, reason: `${name} is an iPhone HEIC photo. Set the camera to “Most Compatible” (JPEG), or export it as JPEG first.` };
  }
  return { ok: false, reason: `${name} doesn’t look like a PDF, Word, PowerPoint, Markdown or image file, whatever its name says.` };
}

/** The title shown for an uploaded file: its name without the extension. */
export function titleFromFilename(name: string): string {
  const base = name.replace(/^.*[\\/]/, '');
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).trim().slice(0, 200) || 'Untitled file';
}

/** Encrypted upload chunk size. Each chunk is its own R2 object and its own AES-GCM envelope. */
export const CHUNK_BYTES = 4 * 1024 * 1024;

export function chunkCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / CHUNK_BYTES));
}
