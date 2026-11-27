// Quick extension/size checks for FileDrop (LIB-02, NFR-SEC). The real type check is by magic bytes in
// src/shared/fileSniff.ts, run in the browser BEFORE encryption (the Worker only ever sees ciphertext,
// ARCHITECTURE A22), so a renamed file can't slip through.

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // Workers request body limit (ARCHITECTURE §3.2)

/** Allowed upload types (LIB-02). SVG is deliberately absent: it can carry scripts. */
export const LIBRARY_UPLOAD_TYPES: readonly string[] = ['.pdf', '.docx', '.pptx', '.md', '.png', '.jpg', '.jpeg', '.webp'];

export type FileLike = { name: string; size: number };

export type FileCheck = { ok: true } | { ok: false; reason: string };

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot).toLowerCase();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function checkFile(file: FileLike, accept: readonly string[] = LIBRARY_UPLOAD_TYPES, maxBytes = MAX_UPLOAD_BYTES): FileCheck {
  const ext = extensionOf(file.name);
  if (!ext || !accept.includes(ext)) {
    const list = accept.map((a) => a.slice(1).toUpperCase()).join(', ');
    return { ok: false, reason: `${file.name}: this file type isn't supported. Use ${list}.` };
  }
  if (file.size === 0) return { ok: false, reason: `${file.name} is empty.` };
  if (file.size > maxBytes) return { ok: false, reason: `${file.name} is ${formatBytes(file.size)}. The limit is ${formatBytes(maxBytes)}.` };
  return { ok: true };
}

/** Split a selection into accepted files and plain-language rejection reasons. */
export function partitionFiles<T extends FileLike>(files: readonly T[], accept?: readonly string[], maxBytes?: number) {
  const accepted: T[] = [];
  const rejected: string[] = [];
  for (const f of files) {
    const check = checkFile(f, accept, maxBytes);
    if (check.ok) accepted.push(f);
    else rejected.push(check.reason);
  }
  return { accepted, rejected };
}
