import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { redis } from '../lib/redis';
import { logger } from '../lib/logger';
import { env } from '../config/env';

/**
 * Redis-backed fixed-window rate limiter.
 *
 * WHY REDIS AND NOT AN IN-MEMORY COUNTER:
 * `api` runs 3 replicas behind Traefik. Per-process counters would let 3x the
 * configured traffic through. This is one of the best answers you can give when
 * the panel asks about load or abuse — make sure you can say it unprompted.
 *
 * Honest limitation: a fixed window allows a 2x burst across a window boundary.
 * A sliding window log fixes it at the cost of memory. Volunteer that.
 */
export function rateLimit(opts?: {
  windowMs?: number;
  max?: number;
  keyPrefix?: string;
}): RequestHandler {
  const windowMs = opts?.windowMs ?? env.RATE_LIMIT_WINDOW_MS;
  const max = opts?.max ?? env.RATE_LIMIT_MAX;
  const keyPrefix = opts?.keyPrefix ?? 'rl';

  return async (req: Request, res: Response, next: NextFunction) => {
    // Prefer the authenticated user; fall back to IP for anonymous traffic.
    const identity = (req as Request & { user?: { id: string } }).user?.id ?? req.ip ?? 'unknown';
    const window = Math.floor(Date.now() / windowMs);
    const key = `${keyPrefix}:${identity}:${window}`;

    try {
      const count = await redis.incr(key);
      if (count === 1) {
        await redis.pexpire(key, windowMs);
      }

      const remaining = Math.max(0, max - count);
      res.setHeader('RateLimit-Limit', max);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.ceil(((window + 1) * windowMs - Date.now()) / 1000));

      if (count > max) {
        const retryAfter = Math.ceil(((window + 1) * windowMs - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter);
        logger.warn({ identity, path: req.path, count }, 'Rate limit exceeded');
        res.status(429).json({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Rate limit exceeded. Slow down.',
            requestId: req.id,
          },
        });
        return;
      }

      next();
    } catch (err) {
      // FAIL OPEN. If Redis is down we would rather serve traffic than 500 the
      // whole API. That is a deliberate trade-off — be ready to defend it.
      logger.error({ err }, 'Rate limiter unavailable, failing open');
      next();
    }
  };
}

/**
 * Tight limit for OTP send/verify — the endpoints bots actually hammer, and
 * the only ones where throttling does not interfere with seat contention.
 * Keyed by phone number where available (see the route), not just IP.
 */
export const otpRateLimit = (): RequestHandler =>
  rateLimit({ max: env.OTP_RATE_LIMIT_MAX, windowMs: 15 * 60_000, keyPrefix: 'rl:otp' });
