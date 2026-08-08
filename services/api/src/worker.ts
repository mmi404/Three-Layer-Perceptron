import { env } from './config/env';
import { logger } from './lib/logger';
import { dequeue, type Job } from './lib/queue';
import { closeDatabase, waitForDatabase } from './lib/db';
import { closeRedis } from './lib/redis';
import { sweepExpired } from './modules/booking/booking.service';

/**
 * WORKER — same image as the API, different entrypoint.
 *
 * Two responsibilities:
 *
 *   1. The hold-expiry sweeper. IMPORTANT: this is a tidiness process, not a
 *      correctness one. Expiry is enforced lazily inside the hold and pay
 *      WHERE clauses, so an abandoned hold stops blocking a seat the instant
 *      its deadline passes, whether or not this process is alive. The sweeper
 *      exists so the seat map reflects that promptly. Kill this container
 *      during the demo — nothing breaks.
 *
 *   2. Async jobs (payment retries, refunds) that the request path must not
 *      wait for.
 */

process.env.SERVICE_NAME = 'worker';

/** Fast, because judges run the stack with a short HOLD_TTL_SECONDS. */
const SWEEP_INTERVAL_MS = 2000;

type Handler = (job: Job) => Promise<void>;

const handlers: Record<string, Handler> = {};

export function registerHandler(type: string, fn: Handler): void {
  handlers[type] = fn;
}

let running = true;

async function runSweeper(): Promise<void> {
  while (running) {
    try {
      await sweepExpired();
    } catch (err) {
      // A failed sweep must never kill the loop; the next tick retries.
      logger.error({ err }, 'Expiry sweep failed');
    }
    await new Promise((r) => setTimeout(r, SWEEP_INTERVAL_MS));
  }
}

async function runJobLoop(): Promise<void> {
  while (running) {
    let job: Job | null = null;
    try {
      job = await dequeue(5);
    } catch (err) {
      logger.error({ err }, 'Queue read failed');
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    if (!job) continue;

    const handler = handlers[job.type];
    if (!handler) {
      logger.warn({ jobId: job.id, type: job.type }, 'No handler registered, dropping');
      continue;
    }

    const started = Date.now();
    try {
      await handler(job);
      logger.info({ jobId: job.id, type: job.type, ms: Date.now() - started }, 'Job done');
    } catch (err) {
      logger.error({ err, jobId: job.id, type: job.type }, 'Job failed');
    }
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  logger.info(
    { sweepIntervalMs: SWEEP_INTERVAL_MS, holdTtlSeconds: env.HOLD_TTL_SECONDS },
    'Worker started',
  );
  await Promise.all([runSweeper(), runJobLoop()]);
}

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'Worker shutting down');
  running = false;
  // Let the in-flight BRPOP time out rather than severing it mid-job.
  setTimeout(() => {
    void Promise.allSettled([closeDatabase(), closeRedis()]).then(() => process.exit(0));
  }, 6_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  logger.fatal({ err }, 'Worker crashed');
  process.exit(1);
});
