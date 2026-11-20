import { API_PREFIX, type ApiError, type ApiSuccess } from '@agency-crm/shared';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Same-origin JSON GET against /api/v1. Cookies are sent automatically; no tokens in JS. */
export async function apiGet<T>(path: string): Promise<ApiSuccess<T>> {
  const res = await fetch(`${API_PREFIX}${path}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  const body = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiError | null;
  if (!res.ok || !body || 'error' in body) {
    const err =
      body && 'error' in body ? body.error : { code: 'HTTP_ERROR', message: res.statusText };
    throw new ApiRequestError(res.status, err.code, err.message);
  }
  return body;
}
