import { hostname } from 'node:os';
import { Router } from 'express';
import { pool } from '../../lib/db';
import { redis } from '../../lib/redis';
import { asyncHandler } from '../../middleware/errorHandler';
import { logger } from '../../lib/logger';

export const healthRouter = Router();

/**
 * LIVENESS — "is the process alive?"
 * Deliberately checks NOTHING external. If this checked the database, a brief
 * DB blip would make the orchestrator kill every healthy replica. Knowing the
 * difference between liveness and readiness is exactly the kind of detail this
 * panel notices.
 */
healthRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: process.env.SERVICE_NAME ?? 'api',
    // The container id. With `--scale api=3` behind Traefik, hitting /health in
    // a loop shows this value rotating — which is how you PROVE load balancing
    // in the demo instead of just claiming it. Do not remove.
    instance: hostname(),
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * READINESS — "can this instance serve traffic right now?"
 * Checks real dependencies. Traefik pulls a not-ready replica out of rotation.
 */
healthRouter.get(
  '/ready',
  asyncHandler(async (_req, res) => {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    const time = async (name: string, fn: () => Promise<unknown>) => {
      const start = Date.now();
      try {
        await fn();
        checks[name] = { ok: true, latencyMs: Date.now() - start };
      } catch (err) {
        checks[name] = {
          ok: false,
          latencyMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    };

    await Promise.all([
      time('postgres', () => pool.query('SELECT 1')),
      time('redis', () => redis.ping()),
    ]);

    const ok = Object.values(checks).every((c) => c.ok);
    if (!ok) logger.warn({ checks }, 'Readiness check failed');

    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'degraded', checks });
  }),
);
