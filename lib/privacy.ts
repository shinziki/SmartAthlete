/**
 * Personal data protection for rows stored in Supabase.
 *
 * - Names and emails are stored masked ("J*****", "j*****@gmail.com"); the real values
 *   live only in Supabase Auth user data.
 * - Rows are found by `email_hash` (SHA-256 of the normalized email) instead of the email.
 * - Passwords are stored as "sha256$<salt>$<hex>", hex = SHA-256 of `${salt}:${password}`
 *   with a random per-password salt (so the hash survives an email change).
 *
 * Keep these formulas in sync with Web/src/privacy.js and supabase_privacy.sql.
 */

const MASK = '*****';
const PASSWORD_PREFIX = 'sha256$';

/** "John" -> "J*****"; empty stays empty. */
export function maskName(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  return v ? `${v[0]}${MASK}` : '';
}

/** "john.doe@gmail.com" -> "j*****@gmail.com" (domain stays readable). */
export function maskEmail(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  const at = v.lastIndexOf('@');
  if (at <= 0) return maskName(v);
  return `${v[0].toLowerCase()}${MASK}${v.slice(at).toLowerCase()}`;
}

/** True for an email already stored in masked form ("j*****@gmail.com"). */
export function isMaskedEmail(value: string): boolean {
  return /^.\*{5}@/.test(value.trim());
}

/** Masks a profile field before it is written to a table; other fields pass through. */
export function maskProfileField(key: string, value: string): string {
  if (key === 'firstName' || key === 'middleName' || key === 'lastName') return maskName(value);
  if (key === 'email') return maskEmail(value);
  return value;
}

/** "John Doe" -> "J***** D*****", for name columns that hold a full name. */
export function maskFullName(value: string | null | undefined): string {
  return (value ?? '').trim().split(/\s+/).filter(Boolean).map(maskName).join(' ');
}

/** Lookup key for a user's row: SHA-256 hex of the trimmed, lower-cased email. */
export function emailHash(email: string): string {
  return sha256Hex(email.trim().toLowerCase());
}

/** A saved login may already be an email hash (coach signed in by username without Auth). */
export function toEmailHash(emailOrHash: string): string {
  const v = emailOrHash.trim();
  return /^[0-9a-f]{64}$/.test(v) ? v : emailHash(v);
}

function randomSalt(): string {
  // Salts only need to be unique, not secret
  let salt = '';
  for (let i = 0; i < 16; i++) salt += Math.floor(Math.random() * 16).toString(16);
  return salt;
}

export function hashPassword(password: string, salt: string = randomSalt()): string {
  return `${PASSWORD_PREFIX}${salt}$${sha256Hex(`${salt}:${password}`)}`;
}

/**
 * Checks a typed password against the stored value. Rows written by older app
 * versions may still hold plain text; `needsUpgrade` tells the caller to re-save it hashed.
 */
export function verifyPassword(
  password: string,
  stored: string | null | undefined
): { ok: boolean; needsUpgrade: boolean } {
  if (!stored) return { ok: true, needsUpgrade: false };
  if (stored.startsWith(PASSWORD_PREFIX)) {
    const salt = stored.slice(PASSWORD_PREFIX.length).split('$')[0];
    return { ok: stored === hashPassword(password, salt), needsUpgrade: false };
  }
  const ok = stored === password;
  return { ok, needsUpgrade: ok };
}

// ─── SHA-256 (FIPS 180-4) over UTF-8, no native module needed ──────

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function utf8Bytes(text: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d;
    h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
