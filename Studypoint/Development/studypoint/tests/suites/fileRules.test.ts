import { LIBRARY_UPLOAD_TYPES, MAX_UPLOAD_BYTES, checkFile, extensionOf, formatBytes, partitionFiles } from '../../src/client/ds/fileRules.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void };

export function register(test: TestFn, assert: Assert): void {
  test('files: extension parsing ignores case and dotfiles', () => {
    assert.equal(extensionOf('Lecture 4.PDF'), '.pdf');
    assert.equal(extensionOf('archive.tar.gz'), '.gz');
    assert.equal(extensionOf('.hidden'), '');
    assert.equal(extensionOf('noext'), '');
    assert.equal(extensionOf('trailing.'), '');
  });

  test('files: allowed library types pass; SVG and unknown types are refused (LIB-02, NFR-SEC)', () => {
    for (const ext of LIBRARY_UPLOAD_TYPES) assert.ok(checkFile({ name: `f${ext}`, size: 10 }).ok, ext);
    assert.ok(!LIBRARY_UPLOAD_TYPES.includes('.svg'));
    assert.ok(!checkFile({ name: 'diagram.svg', size: 10 }).ok);
    assert.ok(!checkFile({ name: 'run.exe', size: 10 }).ok);
  });

  test('files: empty and oversized files are refused with a plain reason', () => {
    const empty = checkFile({ name: 'a.pdf', size: 0 });
    assert.ok(!empty.ok && empty.reason.includes('empty'));
    const big = checkFile({ name: 'big.pdf', size: MAX_UPLOAD_BYTES + 1 });
    assert.ok(!big.ok && big.reason.includes('100 MB'));
  });

  test('files: partition splits accepted files from reasons', () => {
    const { accepted, rejected } = partitionFiles([
      { name: 'notes.md', size: 5 },
      { name: 'x.svg', size: 5 },
      { name: 'slides.pptx', size: 5 },
    ]);
    assert.equal(accepted.length, 2);
    assert.equal(rejected.length, 1);
  });

  test('files: byte formatting', () => {
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2 KB');
    assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB');
    assert.equal(formatBytes(100 * 1024 * 1024), '100 MB');
  });
}
