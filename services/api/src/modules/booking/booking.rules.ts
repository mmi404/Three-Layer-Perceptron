import type { BookingStatus } from './booking.schema';

/**
 * Pure booking rules. No database, no HTTP, no clock of its own — every
 * function takes the time it should judge against. That makes expiry testable
 * without sleeping in a test.
 */

export const BOOKING_TRANSITIONS: Record<BookingStatus, readonly BookingStatus[]> = {
  HELD: ['PENDING_PAYMENT', 'EXPIRED', 'FAILED'],
  PENDING_PAYMENT: ['CONFIRMED', 'FAILED'],
  CONFIRMED: [],          // terminal — a confirmed ticket is never un-confirmed
  FAILED: [],             // terminal
  EXPIRED: [],            // terminal
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  if (from === to) return true;   // idempotent replays must not error
  return BOOKING_TRANSITIONS[from].includes(to);
}

/**
 * A seat is claimable if it is free, or if it is held by someone who has run
 * out of time. This is the lazy-expiry rule, and it is mirrored exactly by the
 * WHERE clause of the hold UPDATE in booking.repo.ts.
 *
 * Because the rule lives in the query, a hold expires on schedule whether or
 * not the sweeper is running. The worker only keeps the seat map tidy.
 */
export function isSeatClaimable(
  seat: { status: string; hold_expires_at: Date | string | null },
  now: Date,
): boolean {
  if (seat.status === 'AVAILABLE') return true;
  if (seat.status !== 'HELD') return false;      // PENDING_PAYMENT or BOOKED
  if (seat.hold_expires_at === null) return false;
  return new Date(seat.hold_expires_at).getTime() < now.getTime();
}

/** A hold is still payable only while it has time left. */
export function isHoldPayable(
  booking: { status: BookingStatus; expires_at: Date | string | null; otp_verified: boolean },
  now: Date,
): { ok: true } | { ok: false; reason: string } {
  if (booking.status !== 'HELD') {
    return { ok: false, reason: `booking is ${booking.status}, not HELD` };
  }
  if (!booking.otp_verified) {
    return { ok: false, reason: 'phone number is not verified' };
  }
  if (booking.expires_at === null) {
    return { ok: false, reason: 'hold has no expiry' };
  }
  if (new Date(booking.expires_at).getTime() <= now.getTime()) {
    return { ok: false, reason: 'hold has expired' };
  }
  return { ok: true };
}

export function totalCents(seats: Array<{ price_cents: number }>): number {
  return seats.reduce((sum, s) => sum + s.price_cents, 0);
}
