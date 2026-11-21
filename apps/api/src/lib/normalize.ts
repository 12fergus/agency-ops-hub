import { validation } from './errors.js';

/**
 * Phone/email normalization used ONLY for duplicate matching.
 * The raw input is always stored unchanged in `phone_raw`.
 */

const ISRAELI_NATIONAL = /^[2-9]\d{7,8}$/; // without trunk 0: 0X-XXXXXXX (8) or 05X-XXXXXXX (9)

/**
 * Returns an E.164-style string or null when the number can't be normalized safely.
 * Rules (no blind country inference):
 *  - explicit international prefix (+ or 00): kept as given; +972 strips a stray trunk 0 ("+972 (0)50…").
 *    Country codes never start with 0.
 *  - "972…" without + and with a valid Israeli length: treated as Israeli
 *  - national format with trunk 0 ("050-1234567", "03-1234567"): Israeli, the agency's locale
 *  - anything else (bare "501234567", extensions, non-ASCII digits): null — not guessed
 * Israeli numbers get a prefix/length plausibility check only, not a numbering-plan lookup.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // Arabic-Indic and other non-ASCII digits would be silently dropped by \D → partial numbers.
  if (/\p{Nd}/u.test(trimmed.replace(/[0-9]/g, ''))) return null;
  let digits = trimmed.replace(/\D/g, '');
  if (!digits) return null;

  const international = trimmed.startsWith('+') || digits.startsWith('00');
  if (international) {
    if (!trimmed.startsWith('+')) digits = digits.slice(2);
    if (digits.startsWith('972')) {
      const national = digits.slice(3).replace(/^0/, '');
      return ISRAELI_NATIONAL.test(national) ? `+972${national}` : null;
    }
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
  }
  if (digits.startsWith('972') && ISRAELI_NATIONAL.test(digits.slice(3))) return `+${digits}`;
  if (digits.startsWith('0') && ISRAELI_NATIONAL.test(digits.slice(1))) {
    return `+972${digits.slice(1)}`;
  }
  return null;
}

/** Trim + lowercase; empty → null. Format validation happens at the API boundary (Zod). */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const v = raw?.trim().toLowerCase();
  return v ? v : null;
}

export const nowIso = (): string => new Date().toISOString();

/**
 * Canonical UTC timestamp for storage. Accepts a Date or an ISO-8601 string WITH an explicit
 * zone ('Z' or ±HH:MM) — a zoneless string is ambiguous (server vs. Asia/Jerusalem) and rejected.
 */
export function toUtcIso(value: Date | string): string {
  if (typeof value === 'string' && !/(Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) {
    throw new RangeError('Timestamp must include a timezone (Z or ±HH:MM)');
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid timestamp');
  return d.toISOString();
}

/** toUtcIso for service inputs: bad timestamps become a 422 VALIDATION AppError. */
export function parseTimestamp(value: string): string {
  try {
    return toUtcIso(value);
  } catch (e) {
    throw validation((e as Error).message);
  }
}
