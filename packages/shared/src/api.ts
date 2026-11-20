/** Success envelope for every /api/v1 response. */
export interface ApiSuccess<T, M = Record<string, unknown>> {
  data: T;
  meta?: M;
}

/** Error envelope for every /api/v1 error. `details` never contains secrets or lead PII. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const API_PREFIX = '/api/v1';
export const MAX_PAGE_SIZE = 100;
