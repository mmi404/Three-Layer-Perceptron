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
import { catalogRouter } from './modules/catalog/catalog.routes';
import { bookingRouter } from './modules/booking/booking.routes';
import { paymentRouter, gatewayCallbackRouter } from './modules/payment/payment.routes';

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
      // "*" is a deliberate default for this event: judges hit the deployed URL
      // from unknown origins and there is no authenticated session to protect.
      // Set CORS_ORIGINS to a comma-separated allowlist for a real deployment.
      origin: env.corsOrigins === '*' ? true : env.corsOrigins,
      credentials: env.corsOrigins !== '*',
      maxAge: 86_400,
    }),
  );

  // Body size cap — without this, a 500 MB JSON body is a free DoS.
  //
  // `verify` stashes the exact raw bytes onto req.rawBody. The gateway callback
  // route (F6) needs those, not the re-serialised object, to check X-Signature:
  // HMAC is computed over bytes-on-the-wire, and re-serialising JSON is not
  // guaranteed to reproduce them byte-for-byte (key order, spacing).
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf);
      },
    }),
  );
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

  // Everything under /api is rate limited, with a high ceiling. Seat
  // contention is resolved in Postgres, not by throttling — see rateLimit.ts.
  // BEFORE the rate limiter, deliberately — see gatewayCallbackRouter.
  app.use('/api/v1/gateway', gatewayCallbackRouter);

  app.use('/api', rateLimit());

  app.use('/api/v1', catalogRouter);
  app.use('/api/v1', bookingRouter);
  app.use('/api/v1', paymentRouter);

  // ORDER IS LOAD-BEARING: 404 after all routes, error handler last of all.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
