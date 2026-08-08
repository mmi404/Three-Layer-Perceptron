import { Router, type Request, type Response, type NextFunction } from 'express';
import client from 'prom-client';
import { circuitState } from '../../lib/gateway';

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

// --- Domain metrics ---------------------------------------------------------
// Under Scenario A these tell the story at a glance: attempted should equal
// won + conflict, won should be exactly 1 per contended seat.

export const holdsAttempted = new client.Counter({
  name: 'holds_attempted_total',
  help: 'Hold requests received',
  registers: [registry],
});

export const holdsWon = new client.Counter({
  name: 'holds_won_total',
  help: 'Hold requests that successfully claimed every requested seat',
  registers: [registry],
});

export const holdsConflict = new client.Counter({
  name: 'holds_conflict_total',
  help: 'Hold requests rejected because a seat was already taken',
  registers: [registry],
});

export const callbacksTotal = new client.Counter({
  name: 'gateway_callbacks_total',
  help: 'Gateway callbacks received, split by whether they were duplicates',
  labelNames: ['dedup'] as const,      // 'hit' = duplicate suppressed
  registers: [registry],
});

// F25: this used to report the depth of a Redis job queue that was never
// actually used (refunds are driven by polling the database, not a queue —
// see worker.ts). Replaced with something that IS load-bearing: the gateway
// circuit breaker's state, which ties directly to the fault-isolation story.
const gatewayCircuitState = new client.Gauge({
  name: 'gateway_circuit_state',
  help: '0 = closed, 1 = half-open, 2 = open (gateway circuit breaker)',
  registers: [registry],
  collect() {
    this.set({ closed: 0, 'half-open': 1, open: 2 }[circuitState()]);
  },
});
void gatewayCircuitState;

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
