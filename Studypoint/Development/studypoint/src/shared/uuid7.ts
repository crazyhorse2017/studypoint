// UUIDv7 IDs (RFC 9562) for every D1 primary key (DATABASE §1).
// Time-ordered, so IDs sort by creation time, and safe to expose.
// Pure: uses only Web Crypto, which exists in browsers and Workers.

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

let lastMs = -1;
let lastSeq = 0;

/** Create a UUIDv7. IDs made within the same millisecond keep increasing (12-bit counter in rand_a). */
export function uuid7(nowMs: number = Date.now()): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  let ms = Math.floor(nowMs);
  let seq: number;
  if (ms > lastMs) {
    // Start the counter low in a random position so there's room to increment.
    seq = ((bytes[6] ?? 0) & 0x07) << 8 | (bytes[7] ?? 0);
  } else {
    // Same millisecond (or the clock went backwards): keep ordering by bumping the counter.
    ms = lastMs;
    seq = lastSeq + 1;
    if (seq > 0xfff) {
      ms = lastMs + 1;
      seq = 0;
    }
  }
  lastMs = ms;
  lastSeq = seq;

  // 48-bit big-endian millisecond timestamp.
  let t = ms;
  for (let i = 5; i >= 0; i -= 1) {
    bytes[i] = t % 256;
    t = Math.floor(t / 256);
  }
  bytes[6] = 0x70 | ((seq >> 8) & 0x0f); // version 7 + high counter bits
  bytes[7] = seq & 0xff;
  bytes[8] = 0x80 | ((bytes[8] ?? 0) & 0x3f); // RFC 9562 variant

  let out = '';
  for (let i = 0; i < 16; i += 1) {
    if (i === 4 || i === 6 || i === 8 || i === 10) out += '-';
    out += HEX[bytes[i] ?? 0];
  }
  return out;
}

const UUID7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** True if the string is a lowercase, well-formed UUIDv7. */
export function isUuid7(value: string): boolean {
  return UUID7_RE.test(value);
}

/** The creation time (Unix ms) stored in a UUIDv7. */
export function uuid7Timestamp(id: string): number {
  if (!isUuid7(id)) throw new Error('Not a UUIDv7');
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/** Test-only: reset the in-process counter so tests are independent. */
export function resetUuid7StateForTests(): void {
  lastMs = -1;
  lastSeq = 0;
}
