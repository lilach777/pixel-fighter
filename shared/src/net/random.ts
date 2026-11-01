/**
 * Cryptographically secure randomness via Web Crypto, available both in browsers (secure
 * contexts: https or localhost) and in Node 20+ as `globalThis.crypto`.
 */
const webcrypto = (): Crypto => {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new Error('Web Crypto is not available in this environment');
  return c;
};

/** Uniform integer in [0, max) without modulo bias. */
export function randomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('max must be an integer in (0, 2^32]');
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    webcrypto().getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/** URL-safe random token from `bytes` random bytes. */
export function randomToken(bytes: number): string {
  const b = webcrypto().getRandomValues(new Uint8Array(bytes));
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(): string {
  return webcrypto().randomUUID();
}
