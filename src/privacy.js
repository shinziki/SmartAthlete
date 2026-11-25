/**
 * Personal data protection for rows stored in Supabase.
 *
 * - Names and emails are stored masked ("J*****", "j*****@gmail.com"); the real values
 *   live only in Supabase Auth user data.
 * - Rows are found by `email_hash` (SHA-256 of the normalized email) instead of the email.
 * - Passwords are stored as "sha256$<salt>$<hex>", hex = SHA-256 of `${salt}:${password}`.
 *
 * Keep these formulas in sync with Mobile/lib/privacy.ts and Mobile/supabase_privacy.sql.
 */

const MASK = '*****'
const PASSWORD_PREFIX = 'sha256$'

export function maskName(value) {
  const v = (value ?? '').trim()
  return v ? `${v[0]}${MASK}` : ''
}

export function maskEmail(value) {
  const v = (value ?? '').trim()
  const at = v.lastIndexOf('@')
  if (at <= 0) return maskName(v)
  return `${v[0].toLowerCase()}${MASK}${v.slice(at).toLowerCase()}`
}

/** True when the database hasn't had supabase_privacy.sql applied yet. */
export function isMissingPrivacyColumn(error) {
  if (!error) return false
  return error.code === '42703' || error.code === 'PGRST204' || /email_hash/.test(error.message ?? '')
}

export function isMaskedEmail(value) {
  return /^.\*{5}@/.test((value ?? '').trim())
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function emailHash(email) {
  return sha256Hex(email.trim().toLowerCase())
}

function randomSalt() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function hashPassword(password, salt = randomSalt()) {
  return `${PASSWORD_PREFIX}${salt}$${await sha256Hex(`${salt}:${password}`)}`
}

/**
 * Checks a typed password against the stored value. Rows written by older versions may
 * still hold plain text; `needsUpgrade` tells the caller to re-save it hashed.
 */
export async function verifyPassword(password, stored) {
  if (!stored) return { ok: true, needsUpgrade: false }
  if (stored.startsWith(PASSWORD_PREFIX)) {
    const salt = stored.slice(PASSWORD_PREFIX.length).split('$')[0]
    return { ok: stored === (await hashPassword(password, salt)), needsUpgrade: false }
  }
  const ok = stored === password
  return { ok, needsUpgrade: ok }
}
