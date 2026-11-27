// Word / Google Docs-style math typing (LIB-08, Alex's LaTeX reference): type a backslash command and
// press space, and it turns into rendered math, e.g. "\alpha␣" → α, "\frac{a}{b}␣", "\sqrt[n]{x}␣",
// "\sum_{i=1}^{n}␣". No $ delimiters. Pure: the editor asks KaTeX whether the command is real before
// converting, so a typo stays as plain text.

/** One brace group, allowing one level of nesting: {a}, {b+\sqrt{x}}. No newlines. */
const GROUP = String.raw`\{(?:[^{}\n]|\{[^{}\n]*\})*\}`;
/** A command, then any argument groups, [optional] args, and ^/_ scripts: \frac{a}{b}, \sum_{i=1}^{n}, \vec{v}. */
const COMMAND = String.raw`\\[A-Za-z]+(?:${GROUP}|\[[^\]\n]*\]|[_^](?:${GROUP}|[A-Za-z0-9]))*`;

/**
 * The text before the cursor must end with: a start or a separator (space, "(", ",", ";", ":"), the
 * command, then the space just typed. "{" and "[" are NOT separators, so "\frac{\alpha " doesn't
 * convert the \alpha that's still inside the braces.
 */
export const TRAILING_COMMAND = new RegExp(String.raw`(^|[\s(,;:])(${COMMAND}) $`);

/** For tests and callers: the command that would convert, or null. */
export function trailingCommand(textBefore: string): string | null {
  const m = TRAILING_COMMAND.exec(textBefore);
  return m && m[2] ? m[2] : null;
}
