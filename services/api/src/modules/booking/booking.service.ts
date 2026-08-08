import { env } from '../../config/env';
import { AppError, NotFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { invalidateSeatMap } from '../catalog/catalog.service';
import { holdsAttempted, holdsConflict, holdsWon } from '../metrics/metrics.routes';
import * as repo from './booking.repo';
import type { CreateHoldInput, HoldResult } from './booking.schema';

/**
 * Place a hold.
 *
 * All contention handling lives in booking.repo.holdSeats — a single guarded
 * UPDATE inside a transaction. There is deliberately no lock, no queue and no
 * retry loop here: adding application-level coordination on top of a database
 * that already serializes correctly is how systems acquire two sources of
 * truth that disagree.
 *
 * `idempotencyKey` (F19): when supplied, a retry with the same key returns
 * the SAME hold instead of fighting the caller's own prior attempt for the
 * seat, or leaving an orphaned hold under a reference the caller never saw.
 */
export async function createHold(
  input: CreateHoldInput,
  idempotencyKey?: string,
): Promise<HoldResult & { replayed?: boolean }> {
  holdsAttempted.inc();
  try {
    const result = await repo.holdSeats(input, env.HOLD_TTL_SECONDS, idempotencyKey);
    holdsWon.inc();

    if (!result.replayed) {
      // Fire-and-forget: a stale cache entry must not fail a successful hold.
      void invalidateSeatMap(input.showtime_id);
      logger.info(
        { bookingRef: result.booking_ref, seats: result.seats.length },
        'Hold created',
      );
    } else {
      logger.info({ bookingRef: result.booking_ref }, 'Hold replayed (idempotency key)');
    }
    return result;
  } catch (err) {
    if (err instanceof AppError && err.code === 'CONFLICT') holdsConflict.inc();
    throw err;
  }
}

export async function getBooking(ref: string) {
  const booking = await repo.findBookingByRef(ref);
  if (!booking) throw NotFound('Booking');
  return booking;
}

/** F21: give a seat back on demand rather than making the user wait out the TTL. */
export async function releaseHold(ref: string): Promise<void> {
  const { released, showtimeId } = await repo.releaseHold(ref);
  if (!released) throw NotFound('Live hold');
  if (showtimeId) void invalidateSeatMap(showtimeId);
  logger.info({ bookingRef: ref }, 'Hold released on request');
}

/**
 * Called by the worker. Loops in bounded batches (F10) until a tick finds
 * nothing left, rather than a single unbounded sweep that could hold
 * thousands of row locks at once after a spike. Capped so one tick can never
 * run away with the worker forever.
 */
const MAX_SWEEP_BATCHES = 20;

export async function sweepExpired(): Promise<number> {
  let totalSeats = 0;
  let totalBookings = 0;
  const touched = new Set<string>();

  for (let i = 0; i < MAX_SWEEP_BATCHES; i++) {
    const { seats, bookings, showtimeIds } = await repo.sweepExpiredHolds();
    showtimeIds.forEach((id) => touched.add(id));
    totalSeats += seats;
    totalBookings += bookings;
    if (seats < repo.SWEEP_BATCH_SIZE && bookings < repo.SWEEP_BATCH_SIZE) break;
  }

  if (totalSeats > 0 || totalBookings > 0) {
    await Promise.all([...touched].map(invalidateSeatMap));
    logger.info({ seats: totalSeats, bookings: totalBookings }, 'Released expired holds');
  }
  return totalSeats;
}
