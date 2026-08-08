import { logger } from './lib/logger';
import { dequeue, type Job } from './lib/queue';
import { closeDatabase, waitForDatabase } from './lib/db';
import { closeRedis } from './lib/redis';

/**
 * WORKER — same image as the API, different entrypoint.
 *
 * This is the split you defend in the presentation: anything the user waits for
 * lives in `api`; anything they do not lives here. One build, one test suite,
 * two independent scaling profiles. `worker` can be slow or crash without ever
 * touching the request path.
 */

process.env.SERVICE_NAME = 'worker';

type Handler = (job: Job) => Promise<void>;

const handlers: Record<string, Handler> = {
  'item.created': async (job) => {
    // Replace with real async work: emails, notifications, report generation,
    // thumbnailing, webhook fan-out, cache warming.
    logger.info({ jobId: job.id, payload: job.payload }, 'Processing item.created');
  },
};

let running = true;

async function processOne(): Promise<void> {
  const job = await dequeue(5);
  if (!job) return; // idle timeout, loop again

  const handler = handlers[job.type];
  if (!handler) {
    logger.warn({ jobId: job.id, type: job.type }, 'No handler registered, dropping');
    return;
  }

  const started = Date.now();
  try {
    await handler(job);
    logger.info({ jobId: job.id, type: job.type, ms: Date.now() - started }, 'Job done');
  } catch (err) {
    // A failed job must never kill the worker loop.
    logger.error({ err, jobId: job.id, type: job.type }, 'Job failed');
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  logger.info('Worker started, waiting for jobs');

  while (running) {
    await processOne();
  }
}

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, 'Worker shutting down');
  running = false;
  // Let the in-flight BRPOP time out rather than severing it mid-job.
  setTimeout(() => {
    void Promise.allSettled([closeDatabase(), closeRedis()]).then(() => process.exit(0));
  }, 6_000).unref();
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  logger.fatal({ err }, 'Worker crashed');
  process.exit(1);
});
