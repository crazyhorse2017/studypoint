/** Join class names, skipping falsy values. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

let counter = 0;
/** Stable-enough unique id prefix for ARIA wiring when React's useId isn't convenient. */
export function nextDsId(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}`;
}
