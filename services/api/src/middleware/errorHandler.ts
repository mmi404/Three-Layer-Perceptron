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

/** Connection-level Postgres/network failures — the DB is unreachable, not just slow. */
const DB_UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', '57P01', '57P03', '08006', '08001', '08004']);

function isDatabaseUnavailable(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  if (code && DB_UNAVAILABLE_CODES.has(code)) return true;
  // pg's pool.connect() times out with a plain Error carrying this message,
  // not a `.code` — it happens when Postgres accepts no new connections at all.
  const message = err instanceof Error ? err.message : '';
  return message.includes('timeout exceeded when trying to connect');
}

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

  // F8: the seat's row lock was busy for longer than lock_timeout (2s). This
  // is a heavily-contended seat working as designed, not a bug — tell the
  // caller to back off and try again rather than making them wait forever
  // or (worse, pre-fix) leaving them holding a pool connection until the
  // connection itself timed out.
  if ((err as { code?: string }).code === '55P03') {
    logger.warn({ requestId: req.id }, 'Lock wait exceeded lock_timeout (contended seat)');
    res.setHeader('Retry-After', '2');
    res.status(503).json({
      error: {
        code: 'SEAT_BUSY',
        message: 'This seat is heavily contended right now, try again shortly',
        requestId: req.id,
      },
    });
    return;
  }

  // F20: Postgres is unreachable. Previously this fell through to the
  // generic 500 branch below, which the fault-isolation bonus specifically
  // says should never happen — "nothing returns 500", degrade cleanly
  // instead. Redis-down already degrades gracefully (rate limiter fails
  // open, seat map falls through to a direct query); this gives Postgres
  // the same honest treatment.
  if (isDatabaseUnavailable(err)) {
    logger.error({ requestId: req.id, err }, 'Database unavailable');
    res.status(503).json({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: 'Temporarily unable to reach the database, try again shortly',
        requestId: req.id,
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
