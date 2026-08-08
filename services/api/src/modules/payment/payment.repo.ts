import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../lib/db';
import { Conflict, NotFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { decideCallback, type CallbackAction, type CallbackStatus, type PaymentStatus } from './payment.rules';

/** Bound on every sweep batch (F10), same reasoning as booking.repo.ts. */
export const SWEEP_BATCH_SIZE = 500;
/** A refund that fails this many times permanently stops retrying (see markRefundFailed). */
export const MAX_REFUND_ATTEMPTS = 5;

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

export type CallbackResult = {
  duplicate: boolean;
  action: CallbackAction;
  showtimeId: string | null;
  gatewayPaymentId: string | null;
};

/**
 * Record the callback's idempotency key AND apply its effect, in ONE
 * transaction. (F4 — this used to be two separate operations: an autocommit
 * INSERT into payment_events, then a second transaction deciding what to do.
 * A crash or a thrown error between them left the event_id permanently
 * marked "seen" with nothing applied — the gateway's retry was then silently
 * deduped away forever, and a payment could be taken with no ticket ever
 * issued and no refund ever triggered. Doing both under one transaction
 * means a rollback also un-marks the event, so the retry does the right
 * thing instead of being swallowed.)
 *
 * The payment row is matched by `gateway_payment_id` when the callback
 * supplies one AND we have already attached it to a row; otherwise by
 * `booking_ref`, most recent first (F5b — this correctly falls back for the
 * documented `race` mode, where the callback can arrive with a payment_id
 * before `/charge` has returned and attached it to our row yet. Matching
 * strictly by ID once it IS known also stops an unrelated older payment
 * attempt on the same booking from being mistaken for the current one).
 */
export async function recordAndApplyCallback(
  eventId: string,
  bookingRef: string | null,
  status: string | null,
  gatewayPaymentId: string | null,
  payload: unknown,
): Promise<CallbackResult> {
  return withTransaction(async (c) => {
    const ins = await c.query<{ event_id: string }>(
      `INSERT INTO payment_events (event_id, booking_ref, status, payload)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [eventId, bookingRef, status, JSON.stringify(payload)],
    );
    if (ins.rowCount === 0) {
      return { duplicate: true, action: 'IGNORE', showtimeId: null, gatewayPaymentId: null };
    }
    if (!bookingRef || !status) {
      return { duplicate: false, action: 'IGNORE', showtimeId: null, gatewayPaymentId: null };
    }

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
          AND ($2::text IS NULL OR p.gateway_payment_id IS NULL OR p.gateway_payment_id = $2)
        ORDER BY (p.gateway_payment_id = $2) DESC NULLS LAST, p.created_at DESC
        LIMIT 1
          FOR UPDATE OF p`,
      [bookingRef, gatewayPaymentId],
    );
    const payment = found.rows[0];
    if (!payment) {
      logger.warn({ bookingRef, eventId }, 'Callback for unknown booking_ref; acknowledging anyway');
      return { duplicate: false, action: 'IGNORE', showtimeId: null, gatewayPaymentId: null };
    }

    const action = decideCallback(payment.status, status as CallbackStatus);

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
    } else if (action === 'REFUND_DONE') {
      // F24: the gateway confirming a refund WE issued. Previously dead code
      // — both REFUNDED branches returned IGNORE, so this never recorded.
      await c.query(
        `UPDATE payments SET status='REFUNDED',
                gateway_payment_id = COALESCE(gateway_payment_id, $2)
          WHERE id = $1`,
        [payment.id, gatewayPaymentId],
      );
      logger.info({ bookingRef, paymentId: payment.id }, 'Refund confirmed by gateway callback');
    }

    return {
      duplicate: false,
      action,
      showtimeId: payment.showtime_id,
      gatewayPaymentId: gatewayPaymentId ?? payment.gateway_payment_id,
    };
  });
}

export async function markRefunded(paymentId: string): Promise<void> {
  await query(
    `UPDATE payments SET status='REFUNDED' WHERE id = $1 AND status = 'REFUND_PENDING'`,
    [paymentId],
  );
}

/**
 * A refund that will never succeed (gateway 404 unknown payment, or 409
 * NOT_REFUNDABLE) gets a terminal state instead of retrying forever. `permanent`
 * distinguishes "the gateway told us plainly, no" from "we simply gave up after
 * MAX_REFUND_ATTEMPTS transient failures" — both stop the reconciler, but only
 * the second is worth alerting on, since it may still be recoverable by hand.
 */
export async function markRefundFailed(paymentId: string, permanent: boolean): Promise<void> {
  await query(
    `UPDATE payments SET status = CASE WHEN $2 THEN 'REFUND_FAILED' ELSE status END,
            refund_attempts = refund_attempts + 1
      WHERE id = $1 AND status = 'REFUND_PENDING'`,
    [paymentId, permanent],
  );
}

export async function listRefundsPending(): Promise<
  Array<{ id: string; gateway_payment_id: string | null; booking_ref: string; refund_attempts: number }>
> {
  return query(
    `SELECT id, gateway_payment_id, booking_ref, refund_attempts FROM payments
      WHERE status = 'REFUND_PENDING' AND gateway_payment_id IS NOT NULL
      ORDER BY updated_at ASC
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
 *
 * Bounded to SWEEP_BATCH_SIZE (F10), same reasoning as the hold sweeper: a
 * mass timeout after an outage must not become one transaction holding
 * hundreds of payment locks for its whole duration. SKIP LOCKED means this
 * never queues behind a live callback that is (rarely) touching the same row.
 */
export async function sweepTimedOutPayments(
  timeoutSeconds: number,
  limit = SWEEP_BATCH_SIZE,
): Promise<{ failed: number; showtimeIds: string[] }> {
  return withTransaction(async (c) => {
    const stale = await c.query<{ id: string; booking_id: string; showtime_id: string }>(
      `SELECT p.id, p.booking_id, b.showtime_id
         FROM payments p JOIN bookings b ON b.id = p.booking_id
        WHERE p.status IN ('INITIATED','PENDING')
          AND p.created_at < now() - make_interval(secs => $1)
        LIMIT $2
          FOR UPDATE OF p SKIP LOCKED`,
      [timeoutSeconds, limit],
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
