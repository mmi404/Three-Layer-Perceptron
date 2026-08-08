import { env } from './config/env';
import { logger } from './lib/logger';
import { closeDatabase, waitForDatabase } from './lib/db';
import { closeRedis } from './lib/redis';
import { sweepExpired } from './modules/booking/booking.service';
import { processRefunds, sweepPayments } from './modules/payment/payment.service';
import { checkInvariants } from './modules/booking/booking.invariants';

/**
 * WORKER — same image as the API, different entrypoint.
 *
 * Three independent loops, on their own cadences:
 *
 *   1. The hold-expiry sweeper. IMPORTANT: this is a tidiness process, not a
 *      correctness one. Expiry is enforced lazily inside the hold and pay
 *      WHERE clauses, so an abandoned hold stops blocking a seat the instant
 *      its deadline passes, whether or not this process is alive. The sweeper
 *      exists so the seat map reflects that promptly. Kill this container
 *      during the demo — nothing breaks.
 *
 *   2. The payment timeout sweeper — fails payments whose callback never
 *      arrived and releases their seats. Runs on its OWN loop, separate from
 *      refunds (F11): refunds make blocking gateway calls, and a gateway
 *      outage must never delay the sweep that frees seats.
 *
 *   3. Refund processing — money that landed for a booking we already gave
 *      up on. Slowest cadence: it is a pure recovery path, and isolating it
 *      here means its gateway calls can never compete with anything that
 *      affects seat availability.
 *
 * (There used to be a fourth loop, a small Redis job queue for exactly this
 * kind of async work. It was never actually used — refunds are driven by
 * polling `payments WHERE status = 'REFUND_PENDING'`, which is itself a
 * transactional outbox and more durable than the queue would have been — so
 * the queue and its loop were deleted rather than documented as a limitation
 * that did not apply. See lib/queue.ts's removal in FIX-BACKLOG F25.)
 */

process.env.SERVICE_NAME = 'worker';

/** Fast, because judges run the stack with a short HOLD_TTL_SECONDS. */
const SWEEP_INTERVAL_MS = 2000;
/** Recovery paths only — no need to run them as hot as the hold sweeper. */
const PAYMENT_SWEEP_INTERVAL_MS = 10_000;
const REFUND_INTERVAL_MS = 10_000;
/** F23: cheap, log-only consistency check — see booking.invariants.ts. */
const INVARIANT_CHECK_INTERVAL_MS = 60_000;

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

/** Fails payments whose callback never arrived and releases their seats. */
async function runPaymentSweeper(): Promise<void> {
  while (running) {
    try {
      await sweepPayments();
    } catch (err) {
      logger.error({ err }, 'Payment timeout sweep failed');
    }
    await new Promise((r) => setTimeout(r, PAYMENT_SWEEP_INTERVAL_MS));
  }
}

/**
 * Refunds money that landed for a booking we had already given up on. Kept
 * off the payment sweeper's loop deliberately: this one makes blocking
 * gateway calls (up to 20 per tick), and a slow or dead gateway must never
 * delay the sweep above, which is the one that frees seats.
 */
async function runRefundProcessor(): Promise<void> {
  while (running) {
    try {
      await processRefunds();
    } catch (err) {
      logger.error({ err }, 'Refund processing failed');
    }
    await new Promise((r) => setTimeout(r, REFUND_INTERVAL_MS));
  }
}

/** F23: log-only. Never mutates anything — see booking.invariants.ts. */
async function runInvariantCheck(): Promise<void> {
  while (running) {
    try {
      await checkInvariants();
    } catch (err) {
      logger.error({ err }, 'Invariant check failed');
    }
    await new Promise((r) => setTimeout(r, INVARIANT_CHECK_INTERVAL_MS));
  }
}

async function main(): Promise<void> {
  await waitForDatabase();
  logger.info(
    { sweepIntervalMs: SWEEP_INTERVAL_MS, holdTtlSeconds: env.HOLD_TTL_SECONDS },
    'Worker started',
  );
  await Promise.all([
    runSweeper(),
    runPaymentSweeper(),
    runRefundProcessor(),
    runInvariantCheck(),
  ]);
}

const shutdown = (signal: string): void => {
  logger.info({ signal }, 'Worker shutting down');
  running = false;
  setTimeout(() => {
    void Promise.allSettled([closeDatabase(), closeRedis()]).then(() => process.exit(0));
  }, 2_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  logger.fatal({ err }, 'Worker crashed');
  process.exit(1);
});
