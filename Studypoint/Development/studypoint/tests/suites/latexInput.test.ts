// LIB-08 Word/Docs-style math typing: "\command" + space converts; $…$ is NOT used.

import { trailingCommand } from '../../src/shared/latexInput.ts';

type TestFn = (name: string, fn: () => void | Promise<void>) => void;
type Assert = { ok(c: unknown, m?: string): void; equal(a: unknown, b: unknown, m?: string): void; deepEqual(a: unknown, b: unknown, m?: string): void };

export function register(test: TestFn, assert: Assert): void {
  test('latex input: a command followed by the space just typed converts', () => {
    assert.equal(trailingCommand('\\alpha '), '\\alpha');
    assert.equal(trailingCommand('The angle \\theta '), '\\theta');
    assert.equal(trailingCommand('so \\frac{a}{b} '), '\\frac{a}{b}');
    assert.equal(trailingCommand('\\sqrt[n]{x} '), '\\sqrt[n]{x}');
    assert.equal(trailingCommand('total \\sum_{i=1}^{n} '), '\\sum_{i=1}^{n}');
    assert.equal(trailingCommand('\\frac{b+\\sqrt{x}}{2a} '), '\\frac{b+\\sqrt{x}}{2a}', 'one level of nested braces');
    assert.equal(trailingCommand('(\\pi '), '\\pi');
    assert.equal(trailingCommand('90^\\circ '), null, 'needs a separator before the backslash');
  });

  test('latex input: nothing converts mid-command, inside braces, or without the trailing space', () => {
    assert.equal(trailingCommand('\\alpha'), null);
    assert.equal(trailingCommand('\\frac{a '), null, 'space typed inside an unfinished brace group');
    assert.equal(trailingCommand('\\frac{\\alpha '), null, "a command inside braces waits for the outer one");
    assert.equal(trailingCommand('\\\\ '), null, 'a line break is not a command');
    assert.equal(trailingCommand('price $5 and $6 '), null, 'dollar signs are plain text now');
    assert.equal(trailingCommand('$x^2$ '), null);
  });
}
