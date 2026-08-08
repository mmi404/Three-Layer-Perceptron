import { randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, query, waitForDatabase } from '../../lib/db';
import { recordAndApplyCallback, sweepTimedOutPayments, startPayment } from './payment.repo';

/**
 * ============================================================================
 *  INTEGRATION TEST — the duplicate-callback path, against a real Postgres.
 * ============================================================================
 *
 * `payment.rules.test.ts` covers decideCallback exhaustively, but as a PURE
 * function — nothing there ever touches a database. The brief asks
 * specifically for tests of "the concurrency and duplicate-callback paths";
 * concurrency had a real-Postgres suite (booking.concurrency.test.ts) and
 * this one did not. The gap mattered: F4 (the callback ledger and its effect
 * committing in two separate transactions) would have been caught by the
 * regression test below, and was not caught by anything until this file
 * existed.
 */

const ref = () => `bk_${randomBytes(6).toString('hex')}`;

let theatreId: string;
let showtimeId: string;
let seatId: string;

beforeAll(async () => {
  await waitForDatabase();

  const [theatre] = await query<{ id: string }>(
    `INSERT INTO theatres (name, city) VALUES ('__cb_test_theatre', 'test') RETURNING id`,
  );
  theatreId = theatre.id;

  const [hall] = await query<{ id: string }>(
    `INSERT INTO halls (theatre_id, name, seat_rows, seat_cols)
     VALUES ($1, 'cb-hall', 1, 1) RETURNING id`,
    [theatreId],
  );

  const [seat] = await query<{ id: string }>(
    `INSERT INTO seats (hall_id, row_label, col_num) VALUES ($1, 'A', 1) RETURNING id`,
    [hall.id],
  );
  seatId = seat.id;

  const [movie] = await query<{ id: string }>(
    `INSERT INTO movies (title, duration_min) VALUES ('__cb_test_movie', 90) RETURNING id`,
  );
  const [showtime] = await query<{ id: string }>(
    `INSERT INTO showtimes (movie_id, hall_id, starts_at, base_price_cents)
     VALUES ($1, $2, now() + interval '1 day', 50000) RETURNING id`,
    [movie.id, hall.id],
  );
  showtimeId = showtime.id;

  await query(
    `INSERT INTO show_seats (showtime_id, seat_id, price_cents) VALUES ($1, $2, 50000)`,
    [showtimeId, seatId],
  );
});

afterAll(async () => {
  await query(`DELETE FROM show_seats WHERE showtime_id = $1`, [showtimeId]);
  await query(
    `DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE showtime_id = $1)`,
    [showtimeId],
  );
  await query(`DELETE FROM bookings WHERE showtime_id = $1`, [showtimeId]);
  await query(`DELETE FROM showtimes WHERE id = $1`, [showtimeId]);
  await query(`DELETE FROM movies WHERE title = '__cb_test_movie'`);
  await query(
    `DELETE FROM seats WHERE hall_id IN (SELECT id FROM halls WHERE theatre_id = $1)`,
    [theatreId],
  );
  await query(`DELETE FROM halls WHERE theatre_id = $1`, [theatreId]);
  await query(`DELETE FROM theatres WHERE id = $1`, [theatreId]);
  await pool.end();
});

/**
 * One seat, reused across tests: reset it to AVAILABLE, then build a
 * PENDING_PAYMENT booking + PENDING payment on top of it — the state a real
 * booking is in by the time a gateway callback would ever arrive.
 */
async function makePendingPayment(
  bookingRef: string,
): Promise<{ bookingId: string; paymentId: string }> {
  await query(
    `UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
      WHERE showtime_id = $1 AND seat_id = $2`,
    [showtimeId, seatId],
  );
  const [booking] = await query<{ id: string }>(
    `INSERT INTO bookings (booking_ref, showtime_id, phone, status, amount_cents, otp_verified)
     VALUES ($1, $2, '+8801700000000', 'PENDING_PAYMENT', 50000, true)
     RETURNING id`,
    [bookingRef, showtimeId],
  );
  await query(
    `UPDATE show_seats SET status = 'PENDING_PAYMENT', booking_id = $1, hold_expires_at = NULL
      WHERE showtime_id = $2 AND seat_id = $3`,
    [booking.id, showtimeId, seatId],
  );
  const [payment] = await query<{ id: string }>(
    `INSERT INTO payments (booking_id, booking_ref, amount_cents, status)
     VALUES ($1, $2, 50000, 'PENDING') RETURNING id`,
    [booking.id, bookingRef],
  );
  return { bookingId: booking.id, paymentId: payment.id };
}

async function bookingStatus(id: string): Promise<string> {
  const [row] = await query<{ status: string }>(`SELECT status FROM bookings WHERE id = $1`, [id]);
  return row.status;
}
async function seatStatus(): Promise<string> {
  const [row] = await query<{ status: string }>(
    `SELECT status FROM show_seats WHERE showtime_id = $1 AND seat_id = $2`,
    [showtimeId, seatId],
  );
  return row.status;
}
async function paymentStatus(id: string): Promise<string> {
  const [row] = await query<{ status: string }>(`SELECT status FROM payments WHERE id = $1`, [id]);
  return row.status;
}

describe('gateway callback — first delivery', () => {
  it('confirms the booking and books the seat on the first SUCCEEDED callback', async () => {
    const r = ref();
    const { bookingId, paymentId } = await makePendingPayment(r);

    const result = await recordAndApplyCallback(`evt_${r}`, r, 'SUCCEEDED', `pay_${r}`, {
      event_id: `evt_${r}`,
      booking_ref: r,
      status: 'SUCCEEDED',
    });

    expect(result.duplicate).toBe(false);
    expect(result.action).toBe('CONFIRM');
    expect(await bookingStatus(bookingId)).toBe('CONFIRMED');
    expect(await seatStatus()).toBe('BOOKED');
    expect(await paymentStatus(paymentId)).toBe('SUCCEEDED');
  });

  it('releases the seat on the first FAILED callback', async () => {
    const r = ref();
    const { bookingId, paymentId } = await makePendingPayment(r);

    const result = await recordAndApplyCallback(`evt_${r}`, r, 'FAILED', null, {
      event_id: `evt_${r}`,
      booking_ref: r,
      status: 'FAILED',
    });

    expect(result.action).toBe('FAIL');
    expect(await bookingStatus(bookingId)).toBe('FAILED');
    expect(await seatStatus()).toBe('AVAILABLE');
    expect(await paymentStatus(paymentId)).toBe('FAILED');
  });
});

describe('gateway callback — duplicates (~8% of deliveries, by specification)', () => {
  it('suppresses the exact same event_id delivered twice: applied exactly once', async () => {
    const r = ref();
    const { bookingId, paymentId } = await makePendingPayment(r);
    const eventId = `evt_${r}`;
    const body = { event_id: eventId, booking_ref: r, status: 'SUCCEEDED' as const };

    const first = await recordAndApplyCallback(eventId, r, 'SUCCEEDED', `pay_${r}`, body);
    const second = await recordAndApplyCallback(eventId, r, 'SUCCEEDED', `pay_${r}`, body);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.action).toBe('IGNORE');
    expect(await bookingStatus(bookingId)).toBe('CONFIRMED');
    expect(await paymentStatus(paymentId)).toBe('SUCCEEDED');
  });

  it('ignores a SECOND, different event_id reporting the same success — no double revenue', async () => {
    const r = ref();
    const { paymentId } = await makePendingPayment(r);

    const first = await recordAndApplyCallback(`evt_a_${r}`, r, 'SUCCEEDED', `pay_${r}`, {});
    const second = await recordAndApplyCallback(`evt_b_${r}`, r, 'SUCCEEDED', `pay_${r}`, {});

    // Not deduped at the ledger (different event_id) — but decideCallback
    // maps an already-SUCCEEDED payment + SUCCEEDED callback to IGNORE, so
    // the second one changes nothing.
    expect(first.action).toBe('CONFIRM');
    expect(second.duplicate).toBe(false);
    expect(second.action).toBe('IGNORE');
    expect(await paymentStatus(paymentId)).toBe('SUCCEEDED');
  });

  it('never revokes a confirmed ticket on a late FAILED after SUCCEEDED', async () => {
    const r = ref();
    const { bookingId, paymentId } = await makePendingPayment(r);

    await recordAndApplyCallback(`evt_ok_${r}`, r, 'SUCCEEDED', `pay_${r}`, {});
    const late = await recordAndApplyCallback(`evt_late_${r}`, r, 'FAILED', `pay_${r}`, {});

    expect(late.action).toBe('IGNORE');
    expect(await bookingStatus(bookingId)).toBe('CONFIRMED');
    expect(await paymentStatus(paymentId)).toBe('SUCCEEDED');
  });
});

describe('gateway callback — arriving after we already gave up', () => {
  it('refunds a late SUCCEEDED after the timeout sweeper failed the payment, without resurrecting the booking', async () => {
    const r = ref();
    const { bookingId, paymentId } = await makePendingPayment(r);

    // Force it stale, then let the real sweeper fail it — exactly the path
    // that would put a payment into FAILED with no callback ever received.
    await query(`UPDATE payments SET created_at = now() - interval '1000 seconds' WHERE id = $1`, [
      paymentId,
    ]);
    const swept = await sweepTimedOutPayments(90, 500);
    expect(swept.failed).toBeGreaterThanOrEqual(1);
    expect(await bookingStatus(bookingId)).toBe('FAILED');
    expect(await seatStatus()).toBe('AVAILABLE');

    // The gateway's callback finally arrives, long after we moved on.
    const result = await recordAndApplyCallback(`evt_${r}`, r, 'SUCCEEDED', `pay_${r}`, {});

    expect(result.action).toBe('REFUND');
    expect(await paymentStatus(paymentId)).toBe('REFUND_PENDING');
    // The booking must NOT come back to life — someone else may hold this
    // seat by now — and the seat must still read as available.
    expect(await bookingStatus(bookingId)).toBe('FAILED');
    expect(await seatStatus()).toBe('AVAILABLE');
  });
});

describe('gateway callback — matching by gateway_payment_id (F5b)', () => {
  it('matches the RACE-mode callback (payment_id arrives before /charge attaches it) by booking_ref', async () => {
    const r = ref();
    const { bookingId, paymentId } = await makePendingPayment(r);
    // No gateway_payment_id attached yet — exactly the documented `race` mode,
    // where the callback can arrive before POST /charge has even returned.

    const result = await recordAndApplyCallback(`evt_${r}`, r, 'SUCCEEDED', `pay_race_${r}`, {});

    expect(result.action).toBe('CONFIRM');
    expect(await bookingStatus(bookingId)).toBe('CONFIRMED');
    expect(await paymentStatus(paymentId)).toBe('SUCCEEDED');
  });

  it('does not let a callback for a DIFFERENT payment_id apply to an unrelated attempt on the same booking', async () => {
    const r = ref();
    const { paymentId } = await makePendingPayment(r);
    // This payment already has an ATTACHED gateway_payment_id — simulating a
    // second, distinct charge attempt existing for the same booking_ref.
    await query(`UPDATE payments SET gateway_payment_id = $1 WHERE id = $2`, [
      `pay_attached_${r}`,
      paymentId,
    ]);

    // A callback claiming a DIFFERENT payment_id for the same booking_ref.
    const result = await recordAndApplyCallback(`evt_${r}`, r, 'SUCCEEDED', `pay_other_${r}`, {});

    // No live candidate matches (this row's id is taken, and there is no
    // NULL-id row to fall back to) — acknowledged, but not misapplied to the
    // wrong payment.
    expect(result.action).toBe('IGNORE');
    expect(await paymentStatus(paymentId)).toBe('PENDING');
  });
});

describe('gateway callback — refund confirmation (F24)', () => {
  it('records REFUNDED when the gateway confirms a refund we issued', async () => {
    const r = ref();
    const { paymentId } = await makePendingPayment(r);
    await query(`UPDATE payments SET status = 'REFUND_PENDING', gateway_payment_id = $1 WHERE id = $2`, [
      `pay_${r}`,
      paymentId,
    ]);

    const result = await recordAndApplyCallback(`evt_${r}`, r, 'REFUNDED', `pay_${r}`, {});

    expect(result.action).toBe('REFUND_DONE');
    expect(await paymentStatus(paymentId)).toBe('REFUNDED');
  });
});

describe('F4 regression — the ledger and its effect are one atomic unit', () => {
  it('rolls back the ledger entry when applying the effect fails partway through', async () => {
    const refA = ref();
    const refB = ref();

    // Two independent bookings, deliberately not touching show_seats — this
    // test only cares about payments/bookings/ledger state.
    const [bookingA] = await query<{ id: string }>(
      `INSERT INTO bookings (booking_ref, showtime_id, phone, status, amount_cents, otp_verified)
       VALUES ($1, $2, '+8801700000000', 'PENDING_PAYMENT', 50000, true) RETURNING id`,
      [refA, showtimeId],
    );
    const [paymentA] = await query<{ id: string }>(
      `INSERT INTO payments (booking_id, booking_ref, amount_cents, status)
       VALUES ($1, $2, 50000, 'PENDING') RETURNING id`,
      [bookingA.id, refA],
    );
    const paymentIdAFresh = paymentA.id;

    const [bookingB] = await query<{ id: string }>(
      `INSERT INTO bookings (booking_ref, showtime_id, phone, status, amount_cents, otp_verified)
       VALUES ($1, $2, '+8801700000000', 'PENDING_PAYMENT', 50000, true) RETURNING id`,
      [refB, showtimeId],
    );
    // Payment B already holds a gateway_payment_id — this is what A's
    // callback will collide with.
    const collidingId = `pay_colliding_${refB}`;
    await query(
      `INSERT INTO payments (booking_id, booking_ref, amount_cents, status, gateway_payment_id)
       VALUES ($1, $2, 50000, 'PENDING', $3)`,
      [bookingB.id, refB, collidingId],
    );

    const eventId = `evt_conflict_${refA}`;
    // A callback for booking A that claims booking B's ALREADY-ATTACHED
    // gateway_payment_id. The UPDATE ... gateway_payment_id = COALESCE(...)
    // will try to set A's row to a value that is UNIQUE across ALL payments,
    // and Postgres rejects it with 23505 — AFTER the payment_events insert
    // for this event has already happened in the SAME transaction.
    await expect(
      recordAndApplyCallback(eventId, refA, 'SUCCEEDED', collidingId, { event_id: eventId }),
    ).rejects.toBeTruthy();

    // If F4 were still broken (two separate transactions), the event_id
    // would be permanently marked "seen" here even though nothing was
    // applied — the retry below would then be silently swallowed as a
    // duplicate, forever. Prove that did NOT happen.
    const ledgerRow = await query<{ event_id: string }>(
      `SELECT event_id FROM payment_events WHERE event_id = $1`,
      [eventId],
    );
    expect(ledgerRow).toHaveLength(0);
    expect(await paymentStatus(paymentIdAFresh)).toBe('PENDING');

    // The gateway's retry — same event_id, this time with A's OWN payment_id
    // — now works, because the failed attempt left no trace.
    const retry = await recordAndApplyCallback(eventId, refA, 'SUCCEEDED', `pay_${refA}`, {
      event_id: eventId,
    });
    expect(retry.duplicate).toBe(false);
    expect(retry.action).toBe('CONFIRM');
    expect(await paymentStatus(paymentIdAFresh)).toBe('SUCCEEDED');
  });
});

describe('concurrent /pay (unique-index guard)', () => {
  it('lets exactly one of two concurrent /pay attempts start a payment', async () => {
    const r = ref();
    await query(
      `UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
        WHERE showtime_id = $1 AND seat_id = $2`,
      [showtimeId, seatId],
    );
    const [booking] = await query<{ id: string }>(
      `INSERT INTO bookings (booking_ref, showtime_id, phone, status, amount_cents, otp_verified, expires_at)
       VALUES ($1, $2, '+8801700000001', 'HELD', 50000, true, now() + interval '2 minutes')
       RETURNING id`,
      [r, showtimeId],
    );
    await query(
      `UPDATE show_seats SET status = 'HELD', booking_id = $1, hold_expires_at = now() + interval '2 minutes'
        WHERE showtime_id = $2 AND seat_id = $3`,
      [booking.id, showtimeId, seatId],
    );

    const results = await Promise.allSettled([startPayment(r), startPayment(r)]);
    const fulfilled = results.filter((res) => res.status === 'fulfilled');
    const rejected = results.filter((res) => res.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
