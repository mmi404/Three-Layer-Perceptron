/**
 * One error shape for the whole API.
 *
 * Consistent status codes and response shapes are an explicit line on the
 * engineering checklist. Throw these from the service layer; the central error
 * handler turns them into responses.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const BadRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);

export const Unauthorized = (msg = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', msg);

export const Forbidden = (msg = 'Not permitted') =>
  new AppError(403, 'FORBIDDEN', msg);

export const NotFound = (resource: string) =>
  new AppError(404, 'NOT_FOUND', `${resource} not found`);

/** Use for business-rule violations: double booking, duplicate email, etc. */
export const Conflict = (msg: string, details?: unknown) =>
  new AppError(409, 'CONFLICT', msg, details);

export const UnprocessableEntity = (msg: string, details?: unknown) =>
  new AppError(422, 'UNPROCESSABLE_ENTITY', msg, details);

export const TooManyRequests = (msg = 'Rate limit exceeded') =>
  new AppError(429, 'TOO_MANY_REQUESTS', msg);
