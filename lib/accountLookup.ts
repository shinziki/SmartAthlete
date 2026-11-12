import { emailHash, isMaskedEmail } from './privacy';
import { supabase } from './supabase';

type AccountTable = 'tbl_athletes' | 'tbl_coaches';

/** True when the database hasn't had supabase_privacy.sql applied yet. */
function isMissingPrivacyColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === '42703' || // undefined column
    error.code === 'PGRST204' || // column not in schema cache
    /email_hash/.test(error.message ?? '')
  );
}

/**
 * Finds an account row by email (or by an email hash saved earlier).
 * Uses email_hash; if the database hasn't been migrated yet, rows still hold the plain
 * email, so it falls back to matching that instead.
 */
export async function findAccountByEmail(
  table: AccountTable,
  emailOrHash: string,
  columns: string
): Promise<{ data: any; error: { code?: string; message?: string } | null }> {
  const value = emailOrHash.trim();
  const isHash = /^[0-9a-f]{64}$/.test(value);
  const res = await supabase
    .from(table)
    .select(columns)
    .eq('email_hash', isHash ? value : emailHash(value))
    .maybeSingle();
  if (!isMissingPrivacyColumn(res.error) || isHash) return res;

  return supabase.from(table).select(columns).ilike('email', value).maybeSingle();
}

/**
 * Checks that the privacy migration has run, so registration can stop before creating
 * an Auth account whose profile row would then fail to save.
 */
export async function hasPrivacySchema(table: AccountTable): Promise<boolean> {
  const { error } = await supabase.from(table).select('email_hash').limit(1);
  return !isMissingPrivacyColumn(error);
}

export const PRIVACY_SCHEMA_MISSING_MESSAGE =
  'Registration is unavailable until the database update (supabase_privacy.sql) has been applied. Please contact your administrator.';

/**
 * The athlete/coach tables only keep a masked email, but Supabase Auth needs the real
 * one to sign in. Resolves it for a username via the login_email_for_username function
 * (see supabase_privacy.sql). Before the database is migrated, the row's email column is
 * still plain, so `rowEmail` is used then. Returns null if no email can be found.
 */
export async function loginEmailForUsername(
  username: string,
  role: 'athlete' | 'coach',
  rowEmail?: string | null
): Promise<string | null> {
  const { data, error } = await supabase.rpc('login_email_for_username', {
    p_username: username.trim(),
    p_role: role,
  });
  if (error) {
    console.warn('[accountLookup] Could not resolve login email:', error.message);
  }
  if (typeof data === 'string' && data) return data;
  return rowEmail && rowEmail.includes('@') && !isMaskedEmail(rowEmail) ? rowEmail.trim() : null;
}
