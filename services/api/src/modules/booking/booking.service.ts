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
 */
export async function createHold(input: CreateHoldInput): Promise<HoldResult> {
  holdsAttempted.inc();
  try {
    const result = await repo.holdSeats(input, env.HOLD_TTL_SECONDS);
    holdsWon.inc();

    // Fire-and-forget: a stale cache entry must not fail a successful hold.
    void invalidateSeatMap(input.showtime_id);

    logger.info(
      { bookingRef: result.booking_ref, seats: result.seats.length },
      'Hold created',
    );
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

/**
 * Called by the worker. Returns the number of seats released so the caller can
 * decide whether anything is worth logging.
 */
export async function sweepExpired(): Promise<number> {
  const { seats, bookings, showtimeIds } = await repo.sweepExpiredHolds();
  if (seats > 0 || bookings > 0) {
    await Promise.all(showtimeIds.map(invalidateSeatMap));
    logger.info({ seats, bookings }, 'Released expired holds');
  }
  return seats;
}
