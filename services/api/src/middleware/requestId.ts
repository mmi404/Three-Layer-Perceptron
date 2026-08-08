import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

/**
 * Correlation ID.
 *
 * Accepts an inbound x-request-id (so a trace survives across services) or
 * mints one. It goes on every log line and into every error response, which is
 * what makes a bug report actionable when three replicas are serving traffic.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && incoming.length <= 100 ? incoming : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
