import { Router, type Request, type Response, type NextFunction } from 'express';
import client from 'prom-client';
import { queueDepth } from '../../lib/queue';

/**
 * Prometheus metrics — the "Monitoring & Observability" bonus, for ~30 lines.
 *
 * Covers three of the four golden signals directly (traffic, errors, latency);
 * saturation comes from the default process metrics plus queue depth below.
 */
export const registry = new client.Registry();
registry.setDefaultLabels({ service: process.env.SERVICE_NAME ?? 'api' });
client.collectDefaultMetrics({ register: registry });

const httpDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'] as const,
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const httpTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [registry],
});

const jobsQueued = new client.Gauge({
  name: 'jobs_queued',
  help: 'Jobs currently waiting in the queue',
  registers: [registry],
  async collect() {
    try {
      this.set(await queueDepth());
    } catch {
      /* Redis down — leave the previous value rather than crash /metrics */
    }
  },
});
void jobsQueued;

/** Mount BEFORE routes so every request is timed. */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const end = httpDuration.startTimer();
  res.on('finish', () => {
    // Use the route PATTERN, not the URL — otherwise every id creates a new
    // time series and Prometheus cardinality explodes.
    const route = req.route?.path ?? req.baseUrl ?? 'unmatched';
    const labels = { method: req.method, route: String(route), status: String(res.statusCode) };
    end(labels);
    httpTotal.inc(labels);
  });
  next();
}

export const metricsRouter = Router();

metricsRouter.get('/metrics', async (_req, res) => {
  res.set('Content-Type', registry.contentType);
  res.send(await registry.metrics());
});
