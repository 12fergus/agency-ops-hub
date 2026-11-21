/**
 * Minimal cookie handling for exactly one cookie (the session). No dependency needed:
 * the value is our own base64url token, so no encoding edge cases.
 */
export const SESSION_COOKIE = 'crm_session';

/** Returns the session cookie value if present and well-formed (base64url, 43 chars). */
export function readSessionCookie(header: string | undefined): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== SESSION_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
  }
  return null;
}

export interface SessionCookieOptions {
  secure: boolean;
  maxAgeSeconds: number;
}

/** HttpOnly (no JS access), SameSite=Lax (not sent on cross-site POSTs), Path=/. */
export function serializeSessionCookie(token: string, opts: SessionCookieOptions): string {
  return [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`,
    ...(opts.secure ? ['Secure'] : []),
  ].join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  return serializeSessionCookie('', { secure, maxAgeSeconds: 0 });
}
