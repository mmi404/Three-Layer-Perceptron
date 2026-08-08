import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../lib/db';
import { Conflict, NotFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { decideCallback, type CallbackAction, type CallbackStatus, type PaymentStatus } from './payment.rules';

// --- Starting a payment -------------------------------------------------------

export type PaymentStart = {
  paymentId: string;
  bookingId: string;
  bookingRef: string;
  showtimeId: string;
  amountCents: number;
  phone: string;
};

/**
 * Move a hold into payment, and create the payment row.
 *
 * CRITICAL ORDERING: the payment row is committed BEFORE we call the gateway.
 * The gateway can deliver its callback before /charge even returns (the
 * documented `race` mode), and the callback matches on booking_ref. If the row
 * did not exist yet, that callback would find nothing and be lost.
 *
 * No network call happens inside this transaction — holding row locks across a
 * flaky external dependency is how a 2% gateway timeout becomes a 100% outage.
 */
export async function startPayment(bookingRef: string): Promise<PaymentStart> {
  return withTransaction(async (c: PoolClient) => {
    const locked = await c.query<{
      id: string;
      showtime_id: string;
      phone: string;
      status: string;
      amount_cents: number;
      otp_verified: boolean;
      expired: boolean;
    }>(
      `SELECT id, showtime_id, phone, status, amount_cents, otp_verified,
              (expires_at IS NOT NULL AND expires_at <= now()) AS expired
         FROM bookings WHERE booking_ref = $1 FOR UPDATE`,
      [bookingRef],
    );
    const booking = locked.rows[0];
    if (!booking) throw NotFound('Booking');

    if (booking.status !== 'HELD') {
      throw Conflict(`Booking is ${booking.status}; only a live hold can be paid`, {
        status: booking.status,
      });
    }
    if (booking.expired) {
      throw Conflict('Hold has expired', { status: 'EXPIRED' });
    }
    if (!booking.otp_verified) {
      throw Conflict('Phone number must be verified before payment', {
        code: 'OTP_REQUIRED',
      });
    }

    // Guarded transition. Re-states the conditions above so the write itself
    // is safe even if two /pay requests race past the checks.
    const moved = await c.query(
      `UPDATE bookings SET status = 'PENDING_PAYMENT', expires_at = NULL
        WHERE id = $1 AND status = 'HELD' AND otp_verified`,
      [booking.id],
    );
    if (moved.rowCount !== 1) throw Conflict('Booking is no longer payable');

    await c.query(
      `UPDATE show_seats SET status = 'PENDING_PAYMENT', hold_expires_at = NULL
        WHERE booking_id = $1 AND status = 'HELD'`,
      [booking.id],
    );

    // The partial unique index makes a second live payment impossible.
    let paymentId: string;
    try {
      const p = await c.query<{ id: string }>(
        `INSERT INTO payments (booking_id, booking_ref, amount_cents, status)
         VALUES ($1, $2, $3, 'INITIATED') RETURNING id`,
        [booking.id, bookingRef, booking.amount_cents],
      );
      paymentId = p.rows[0].id;
    } catch (err) {
      if ((err as { code?: string }).code === '23505') {
        throw Conflict('A payment is already in progress for this booking');
      }
      throw err;
    }

    return {
      paymentId,
      bookingId: booking.id,
      bookingRef,
      showtimeId: booking.showtime_id,
      amountCents: booking.amount_cents,
      phone: booking.phone,
    };
  });
}

export async function attachGatewayPaymentId(
  paymentId: string,
  gatewayPaymentId: string,
): Promise<void> {
  // A callback may already have set this (race mode). Never overwrite.
  await query(
    `UPDATE payments SET gateway_payment_id = COALESCE(gateway_payment_id, $2),
            status = CASE WHEN status = 'INITIATED' THEN 'PENDING' ELSE status END
      WHERE id = $1`,
    [paymentId, gatewayPaymentId],
  );
}

/**
 * The gateway would not accept the charge at all. Fail the payment and give
 * the seats back immediately rather than pinning them until the timeout.
 *
 * Note the deliberate consequence: if the gateway actually *did* receive the
 * charge (a timeout tells us nothing about what happened at the other end) and
 * money later lands, the callback finds a FAILED payment and decideCallback
 * returns REFUND. We would rather refund a real payment than oversell a seat.
 */
export async function abandonPayment(
  paymentId: string,
): Promise<{ showtimeId: string | null }> {
  return withTransaction(async (c) => {
    const found = await c.query<{ booking_id: string; showtime_id: string }>(
      `SELECT p.booking_id, b.showtime_id FROM payments p
         JOIN bookings b ON b.id = p.booking_id
        WHERE p.id = $1 FOR UPDATE OF p`,
      [paymentId],
    );
    const row = found.rows[0];
    if (!row) return { showtimeId: null };

    await c.query(
      `UPDATE payments SET status='FAILED', attempts = attempts + 1
        WHERE id = $1 AND status IN ('INITIATED','PENDING')`,
      [paymentId],
    );
    await c.query(
      `UPDATE bookings SET status='FAILED', expires_at=NULL
        WHERE id = $1 AND status='PENDING_PAYMENT'`,
      [row.booking_id],
    );
    await c.query(
      `UPDATE show_seats SET status='AVAILABLE', booking_id=NULL, hold_expires_at=NULL
        WHERE booking_id = $1`,
      [row.booking_id],
    );
    return { showtimeId: row.showtime_id };
  });
}

// --- Callback -----------------------------------------------------------------

/**
 * The dedupe gate. Returns false if we have seen this event_id before.
 *
 * A primary key, not a SELECT-then-INSERT: two replicas can receive the same
 * duplicate simultaneously and exactly one of them will win the insert.
 */
export async function recordEventIfNew(
  eventId: string,
  bookingRef: string | null,
  status: string | null,
  payload: unknown,
): Promise<boolean> {
  const rows = await query<{ event_id: string }>(
    `INSERT INTO payment_events (event_id, booking_ref, status, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING event_id`,
    [eventId, bookingRef, status, JSON.stringify(payload)],
  );
  return rows.length > 0;
}

export type CallbackOutcome = {
  action: CallbackAction;
  showtimeId: string | null;
  gatewayPaymentId: string | null;
};

/**
 * Apply a (already de-duplicated) callback.
 *
 * Everything happens under a row lock on the payment, so two different events
 * for the same booking cannot interleave and produce a half-applied state.
 */
export async function applyCallback(
  bookingRef: string,
  incoming: CallbackStatus,
  gatewayPaymentId: string | null,
): Promise<CallbackOutcome> {
  return withTransaction(async (c) => {
    const found = await c.query<{
      id: string;
      booking_id: string;
      status: PaymentStatus;
      gateway_payment_id: string | null;
      showtime_id: string;
    }>(
      `SELECT p.id, p.booking_id, p.status, p.gateway_payment_id, b.showtime_id
         FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE p.booking_ref = $1
        ORDER BY p.created_at DESC LIMIT 1
          FOR UPDATE OF p`,
      [bookingRef],
    );
    const payment = found.rows[0];
    if (!payment) {
      logger.warn({ bookingRef }, 'Callback for unknown booking_ref; acknowledging anyway');
      return { action: 'IGNORE' as const, showtimeId: null, gatewayPaymentId: null };
    }

    const action = decideCallback(payment.status, incoming);

    if (action === 'CONFIRM') {
      await c.query(
        `UPDATE payments SET status='SUCCEEDED',
                gateway_payment_id = COALESCE(gateway_payment_id, $2)
          WHERE id = $1`,
        [payment.id, gatewayPaymentId],
      );
      await c.query(
        `UPDATE bookings SET status='CONFIRMED', expires_at = NULL
          WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
        [payment.booking_id],
      );
      await c.query(
        `UPDATE show_seats SET status='BOOKED', hold_expires_at = NULL
          WHERE booking_id = $1 AND status = 'PENDING_PAYMENT'`,
        [payment.booking_id],
      );
    } else if (action === 'FAIL') {
      await c.query(
        `UPDATE payments SET status='FAILED',
                gateway_payment_id = COALESCE(gateway_payment_id, $2)
          WHERE id = $1`,
        [payment.id, gatewayPaymentId],
      );
      await c.query(
        `UPDATE bookings SET status='FAILED', expires_at = NULL
          WHERE id = $1 AND status = 'PENDING_PAYMENT'`,
        [payment.booking_id],
      );
      // Release the seats so someone else can buy them.
      await c.query(
        `UPDATE show_seats SET status='AVAILABLE', booking_id=NULL, hold_expires_at=NULL
          WHERE booking_id = $1`,
        [payment.booking_id],
      );
    } else if (action === 'REFUND') {
      // Money for a booking we already released. Do NOT resurrect the booking.
      await c.query(
        `UPDATE payments SET status='REFUND_PENDING',
                gateway_payment_id = COALESCE(gateway_payment_id, $2)
          WHERE id = $1`,
        [payment.id, gatewayPaymentId],
      );
      logger.warn(
        { bookingRef, paymentId: payment.id },
        'Late success for an abandoned booking; refund required',
      );
    }

    return {
      action,
      showtimeId: payment.showtime_id,
      gatewayPaymentId: gatewayPaymentId ?? payment.gateway_payment_id,
    };
  });
}

export async function markRefunded(paymentId: string): Promise<void> {
  await query(`UPDATE payments SET status='REFUNDED' WHERE id = $1`, [paymentId]);
}

export async function listRefundsPending(): Promise<
  Array<{ id: string; gateway_payment_id: string | null; booking_ref: string }>
> {
  return query(
    `SELECT id, gateway_payment_id, booking_ref FROM payments
      WHERE status = 'REFUND_PENDING' AND gateway_payment_id IS NOT NULL
      LIMIT 20`,
  );
}

// --- OTP ----------------------------------------------------------------------

export async function findBookingForOtp(
  ref: string,
): Promise<{ id: string; phone: string; status: string; otp_verified: boolean } | null> {
  const rows = await query<{ id: string; phone: string; status: string; otp_verified: boolean }>(
    `SELECT id, phone, status, otp_verified FROM bookings WHERE booking_ref = $1`,
    [ref],
  );
  return rows[0] ?? null;
}

export async function markOtpVerified(ref: string): Promise<void> {
  await query(`UPDATE bookings SET otp_verified = true WHERE booking_ref = $1`, [ref]);
}

// --- Timeout sweeper ----------------------------------------------------------

/**
 * Fail payments that never got a callback, and release their seats.
 *
 * Without this a lost callback would pin a seat forever: the booking is out of
 * HELD, so the hold sweeper will not touch it.
 */
export async function sweepTimedOutPayments(
  timeoutSeconds: number,
): Promise<{ failed: number; showtimeIds: string[] }> {
  return withTransaction(async (c) => {
    const stale = await c.query<{ id: string; booking_id: string; showtime_id: string }>(
      `SELECT p.id, p.booking_id, b.showtime_id
         FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE p.status IN ('INITIATED','PENDING')
          AND p.created_at < now() - make_interval(secs => $1)
        FOR UPDATE OF p`,
      [timeoutSeconds],
    );
    if (stale.rows.length === 0) return { failed: 0, showtimeIds: [] };

    const ids = stale.rows.map((r) => r.id);
    const bookingIds = stale.rows.map((r) => r.booking_id);

    await c.query(`UPDATE payments SET status='FAILED' WHERE id = ANY($1::uuid[])`, [ids]);
    await c.query(
      `UPDATE bookings SET status='FAILED', expires_at=NULL
        WHERE id = ANY($1::uuid[]) AND status='PENDING_PAYMENT'`,
      [bookingIds],
    );
    await c.query(
      `UPDATE show_seats SET status='AVAILABLE', booking_id=NULL, hold_expires_at=NULL
        WHERE booking_id = ANY($1::uuid[])`,
      [bookingIds],
    );

    return {
      failed: ids.length,
      showtimeIds: [...new Set(stale.rows.map((r) => r.showtime_id))],
    };
  });
}
