import type { PublicSeatStatus } from './catalog.schema';

/**
 * Pure projection of internal seat state onto what a buyer is allowed to see.
 * No database, no HTTP — unit tested directly.
 *
 * Two deliberate decisions live here:
 *
 *  1. PENDING_PAYMENT is reported as "held", not as a distinct state. Whether
 *     someone is mid-payment is our business, not the browsing public's, and
 *     leaking it would tell a competitor exactly when to retry.
 *
 *  2. Expiry is applied LAZILY. A hold past its deadline reads as available
 *     even if the sweeper has not run, so the map matches what a hold request
 *     would actually do. Correctness never waits on the worker.
 */
export function projectSeatStatus(
  status: string,
  holdLive: boolean,
): PublicSeatStatus {
  switch (status) {
    case 'BOOKED':
      return 'booked';
    case 'PENDING_PAYMENT':
      return 'held';
    case 'HELD':
      return holdLive ? 'held' : 'available';
    default:
      return 'available';
  }
}
