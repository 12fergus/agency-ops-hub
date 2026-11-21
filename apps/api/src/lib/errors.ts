import type { ApiError } from '@agency-crm/shared';

/** Domain error mapped to the {error:{code,message}} envelope. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (entity: string) => new AppError(404, 'NOT_FOUND', `${entity} not found`);

/**
 * A referenced row exists but belongs to another client/pipeline. Never says which client.
 * TODO(Phase 2, auth): for rows the ACTOR cannot access, return notFound() instead so a caller
 * can't probe for the existence of other clients' IDs.
 */
export const crossClient = (what: string) =>
  new AppError(422, 'CROSS_CLIENT_REFERENCE', `${what} does not belong to this client`);

export const invalidAssignee = () =>
  new AppError(422, 'INVALID_ASSIGNEE', 'Assignee is inactive or has no access to this client');

/** The caller is authenticated but their role may not do this (used for role and client rules). */
export const forbidden = (message = 'You do not have permission for this action') =>
  new AppError(403, 'FORBIDDEN', message);

export const validation = (message: string) => new AppError(422, 'VALIDATION', message);

export const invalidState = (message: string) => new AppError(409, 'INVALID_STATE', message);

export function errorBody(code: string, message: string, details?: unknown): ApiError {
  return { error: details === undefined ? { code, message } : { code, message, details } };
}
