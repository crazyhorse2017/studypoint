// LIB-02 / NFR-SEC: the real file type comes from the bytes, not the name (checked before encryption).
// Plus the binary chunk envelope used for encrypted files.

import { CHUNK_BYTES, chunkCount, sniffFile, titleFromFilename } from '../../src/shared/fileSniff.ts';
import { BYTES_OVERHEAD, CryptoError, chunkAad, deriveFingerprintKey, fingerprint, importDataKey, openBytes, randomBytes, sealBytes } from '../../src/shared/crypto/vault.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

const bytes = (...parts: Array<string | number[]>) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? Array.from(new TextEncoder().encode(p)) : p));
  return new Uint8Array(out);
};
const kind = (b: Uint8Array, name: string) => {
  const s = sniffFile(b, name);
  return s.ok ? s.kind : `refused`;
};

export function register(test: TestFn, assert: Assert): void {
  test('sniff: PDF, PNG, JPEG, WebP, DOCX, PPTX and Markdown are recognised from their bytes', () => {
    assert.equal(kind(bytes('%PDF-1.7\n...'), 'x.pdf'), 'pdf');
    assert.equal(kind(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), 'x.png'), 'image');
    assert.equal(kind(bytes([0xff, 0xd8, 0xff, 0xe0]), 'x.jpg'), 'image');
    assert.equal(kind(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '), 'x.webp'), 'image');
    assert.equal(kind(bytes([0x50, 0x4b, 3, 4], '....word/document.xml....'), 'x.docx'), 'docx');
    assert.equal(kind(bytes([0x50, 0x4b, 3, 4], '....ppt/presentation.xml....'), 'x.pptx'), 'pptx');
    assert.equal(kind(bytes('# Heading\n\nSome *notes*.'), 'notes.md'), 'md');
  });

  test('sniff: renamed, disguised and unsupported files are refused', () => {
    assert.equal(kind(bytes('MZ\x90\x00 this is an exe'), 'lecture.pdf'), 'refused', 'an .exe named .pdf');
    assert.equal(kind(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'), 'photo.md'), 'refused', 'SVG disguised as Markdown');
    assert.equal(kind(bytes('<!DOCTYPE html><html>'), 'page.md'), 'refused');
    assert.equal(kind(bytes([0x50, 0x4b, 3, 4], 'random.zip contents'), 'x.docx'), 'refused', 'a ZIP that is not Office');
    assert.equal(kind(bytes('plain text'), 'notes.txt'), 'refused');
    assert.equal(kind(bytes([0, 1, 2, 3]), 'binary.md'), 'refused', 'binary named .md');
    const heic = sniffFile(bytes([0, 0, 0, 0x18], 'ftypheic'), 'IMG_0001.HEIC');
    assert.ok(!heic.ok && heic.reason.includes('Most Compatible'), 'HEIC gets a helpful message');
  });

  test('files: titles drop the extension and folders; chunk counts round up', () => {
    assert.equal(titleFromFilename('C:\\Users\\me\\Week 3 – Heat transfer.pdf'), 'Week 3 – Heat transfer');
    assert.equal(titleFromFilename('.pdf'), '.pdf');
    assert.equal(chunkCount(1), 1);
    assert.equal(chunkCount(CHUNK_BYTES), 1);
    assert.equal(chunkCount(CHUNK_BYTES + 1), 2);
  });

  test('chunks: binary envelopes round-trip; a chunk moved to another index, file or total is refused', async () => {
    const key = await importDataKey(randomBytes(32));
    const data = randomBytes(1000);
    const sealed = await sealBytes(key, data, chunkAad('v1', 0, 3));
    assert.equal(sealed.length, data.length + BYTES_OVERHEAD);
    const back = await openBytes(key, sealed, chunkAad('v1', 0, 3));
    assert.ok(back.every((b, i) => b === data[i]));
    for (const aad of [chunkAad('v1', 1, 3), chunkAad('v2', 0, 3), chunkAad('v1', 0, 2)]) {
      let refused = false;
      try { await openBytes(key, sealed, aad); } catch (e) { refused = e instanceof CryptoError; }
      assert.ok(refused, `refused for ${aad}`);
    }
  });

  test('fingerprints: same bytes → same fingerprint per account; different accounts can’t compare', async () => {
    const a = await deriveFingerprintKey(randomBytes(32));
    const b = await deriveFingerprintKey(randomBytes(32));
    const data = bytes('%PDF-1.7 same file');
    assert.equal(await fingerprint(a, data), await fingerprint(a, data));
    assert.ok((await fingerprint(a, data)) !== (await fingerprint(b, data)));
    assert.ok(/^[0-9a-f]{64}$/.test(await fingerprint(a, data)));
  });
}
