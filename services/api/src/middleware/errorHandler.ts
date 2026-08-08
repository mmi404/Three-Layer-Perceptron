import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/**
 * Express 4 does not catch rejected promises from async handlers — an unhandled
 * rejection there means the request hangs until it times out. Wrap every async
 * handler in this.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    void fn(req, res, next).catch(next);
  };

/** 404 for anything that matched no route. Mount after all routes. */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} does not exist`,
      requestId: req.id,
    },
  });
}

/**
 * Central error handler — the ONLY place that formats an error response.
 * Errors are logged, never swallowed. Internal details never leak to clients.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  // Validation failure -> 422 with per-field detail the frontend can render.
  if (err instanceof ZodError) {
    logger.warn({ requestId: req.id, issues: err.issues }, 'Validation failed');
    res.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        requestId: req.id,
        details: err.issues.map((i) => ({
          field: i.path.join('.'),
          message: i.message,
        })),
      },
    });
    return;
  }

  // Expected, deliberately-thrown application errors.
  if (err instanceof AppError) {
    logger.warn(
      { requestId: req.id, code: err.code, statusCode: err.statusCode },
      err.message,
    );
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        requestId: req.id,
        ...(err.details ? { details: err.details } : {}),
      },
    });
    return;
  }

  // Anything else is a bug. Log it in full; tell the client almost nothing.
  logger.error({ requestId: req.id, err }, 'Unhandled error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      requestId: req.id,
      ...(env.isProd ? {} : { debug: err instanceof Error ? err.message : String(err) }),
    },
  });
}
