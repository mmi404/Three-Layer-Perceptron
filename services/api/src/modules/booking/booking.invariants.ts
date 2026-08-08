import { query } from '../../lib/db';
import { logger } from '../../lib/logger';

/**
 * F23 — "BOOKED seats and CONFIRMED bookings are not structurally tied."
 *
 * The CHECK constraint on show_seats guarantees a non-AVAILABLE seat belongs
 * to SOME booking; nothing in the schema guarantees that a BOOKED seat's
 * booking is actually CONFIRMED, or that a SUCCEEDED payment's booking is.
 * Today those facts are kept aligned by every write path updating all three
 * tables in the same transaction — true, but a convention, not a guarantee a
 * future code path is forced to honour.
 *
 * This is deliberately NOT a constraint (a CHECK cannot reference another
 * table, and a cross-table trigger is real complexity for a check that has
 * never actually fired). It is a periodic, read-only, log-only sweep: cheap
 * insurance that turns a silent divergence into a page rather than a mystery
 * bug report. It never mutates anything — if it ever finds a row, the fix is
 * to look at the write path that produced it, not to have the checker "fix"
 * data it does not fully understand the history of.
 */
export async function checkInvariants(): Promise<{ violations: number }> {
  const [bookedWithoutConfirmed, succeededWithoutConfirmed] = await Promise.all([
    query<{ showtime_id: string; seat_id: string; booking_id: string; booking_status: string }>(
      `SELECT ss.showtime_id, ss.seat_id, ss.booking_id, b.status AS booking_status
         FROM show_seats ss JOIN bookings b ON b.id = ss.booking_id
        WHERE ss.status = 'BOOKED' AND b.status <> 'CONFIRMED'
        LIMIT 20`,
    ),
    query<{ payment_id: string; booking_id: string; booking_status: string }>(
      `SELECT p.id AS payment_id, p.booking_id, b.status AS booking_status
         FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE p.status = 'SUCCEEDED' AND b.status <> 'CONFIRMED'
        LIMIT 20`,
    ),
  ]);

  const violations = bookedWithoutConfirmed.length + succeededWithoutConfirmed.length;
  if (violations > 0) {
    logger.error(
      { bookedWithoutConfirmed, succeededWithoutConfirmed },
      'Invariant violation: seat/payment state disagrees with booking state (F23)',
    );
  }
  return { violations };
}
