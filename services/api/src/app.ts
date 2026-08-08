import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { logger } from './lib/logger';
import { requestId } from './middleware/requestId';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { rateLimit } from './middleware/rateLimit';
import { healthRouter } from './modules/health/health.routes';
import { metricsRouter, metricsMiddleware } from './modules/metrics/metrics.routes';
import { itemsRouter } from './modules/items/items.routes';

/**
 * App assembly. Middleware ORDER matters — it is top to bottom:
 *   ids -> security -> parsing -> logging -> metrics -> limits -> routes -> errors
 */
export function createApp() {
  const app = express();

  // Behind Traefik, so req.ip must come from X-Forwarded-For or every client
  // shares one rate-limit bucket. `1` = trust exactly one proxy hop.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(helmet());
  app.use(
    cors({
      origin: env.corsOrigins,       // allowlist, never "*"
      credentials: true,
      maxAge: 86_400,
    }),
  );

  // Body size cap — without this, a 500 MB JSON body is a free DoS.
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/metrics' },
    }),
  );

  app.use(metricsMiddleware);

  // Unauthenticated infrastructure endpoints — no rate limit.
  app.use(healthRouter);
  app.use(metricsRouter);

  // Everything under /api is rate limited.
  app.use('/api', rateLimit());
  app.use('/api/v1/items', itemsRouter);

  // ORDER IS LOAD-BEARING: 404 after all routes, error handler last of all.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
