import { API_PREFIX, type ApiError, type ApiSuccess } from '@agency-crm/shared';
import { he } from './i18n/he';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Server validation details (field paths + codes, never values). */
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Same-origin JSON request against /api/v1. The session lives in an HttpOnly cookie that the
 * browser sends automatically — no token is ever readable or stored by JS (no localStorage).
 * The browser adds the Origin header the server checks for CSRF.
 */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<ApiSuccess<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    // fetch only rejects when no HTTP response arrived (server down, network/VPN/Wi-Fi issue).
    throw new ApiRequestError(0, 'NETWORK', err instanceof Error ? err.message : 'Network error');
  }
  // Non-JSON bodies (e.g. a proxy's HTML error page) are reported as HTTP_ERROR below.
  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiError | null;
  if (!res.ok || !json || 'error' in json) {
    const err =
      json && 'error' in json ? json.error : { code: 'HTTP_ERROR', message: res.statusText };
    throw new ApiRequestError(
      res.status,
      err.code,
      err.message,
      'details' in err ? err.details : undefined,
    );
  }
  return json;
}

export const apiGet = <T>(path: string) => apiRequest<T>('GET', path);

/** Hebrew message for an API error code (falls back to a generic message; never shows raw text). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    // Password-policy errors arrive as VALIDATION with the specific policy code as message.
    const specific = `error.${err.message}` as keyof typeof he;
    if (err.code === 'VALIDATION' && specific in he) return he[specific];
    const key = `error.${err.code}` as keyof typeof he;
    if (key in he) return he[key];
  }
  return he['error.generic'];
}

/**
 * Multipart upload (e.g. a client photo). The browser sets the multipart boundary itself, sends
 * the session cookie and the Origin header (CSRF check) — same rules as apiRequest.
 */
export async function apiUpload<T>(path: string, form: FormData): Promise<ApiSuccess<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_PREFIX}${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      body: form,
    });
  } catch (err) {
    throw new ApiRequestError(0, 'NETWORK', err instanceof Error ? err.message : 'Network error');
  }
  const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiError | null;
  if (!res.ok || !json || 'error' in json) {
    const err =
      json && 'error' in json ? json.error : { code: 'HTTP_ERROR', message: res.statusText };
    throw new ApiRequestError(res.status, err.code, err.message);
  }
  return json;
}
