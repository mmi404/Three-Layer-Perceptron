import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../lib/db';
import { Conflict, NotFound } from '../../lib/errors';
import type { CreateHoldInput, HoldResult } from './booking.schema';

/** Bound on every sweep batch (F10) — a mass expiry must not become one
 *  transaction holding thousands of row locks at once. */
export const SWEEP_BATCH_SIZE = 500;

export function newBookingRef(): string {
  return `bk_${randomBytes(6).toString('hex')}`;   // bk_ + 12 hex chars
}

type LockedSeat = {
  seat_id: string;
  status: string;
  price_cents: number;
  hold_expires_at: Date | null;
  label: string;
  booking_id: string | null;
};

/** Look up a still-live hold created under this idempotency key (F19). */
async function findLiveHoldByIdempotencyKey(
  c: PoolClient,
  idempotencyKey: string,
  ttlSeconds: number,
): Promise<(HoldResult & { replayed: true }) | null> {
  const existing = await c.query<{
    id: string;
    booking_ref: string;
    showtime_id: string;
    amount_cents: number;
    expires_at: string;
  }>(
    `SELECT id, booking_ref, showtime_id, amount_cents, expires_at
       FROM bookings
      WHERE idempotency_key = $1 AND status = 'HELD'`,
    [idempotencyKey],
  );
  const b = existing.rows[0];
  if (!b) return null;

  const seats = await c.query<{ seat_id: string; label: string; price_cents: number }>(
    `SELECT s.id AS seat_id, s.row_label || s.col_num AS label, ss.price_cents
       FROM show_seats ss JOIN seats s ON s.id = ss.seat_id
      WHERE ss.booking_id = $1
      ORDER BY s.row_label, s.col_num`,
    [b.id],
  );

  return {
    booking_ref: b.booking_ref,
    showtime_id: b.showtime_id,
    status: 'HELD' as const,
    seats: seats.rows,
    amount_cents: b.amount_cents,
    expires_at: new Date(b.expires_at).toISOString(),
    hold_ttl_seconds: ttlSeconds,
    replayed: true,
  };
}

/**
 * ============================================================================
 *  THE HOLD.  This is the answer to "100 users, one seat, zero oversell".
 * ============================================================================
 *
 * Three mechanisms, in order:
 *
 *  1. SELECT ... FOR UPDATE, ordered by seat_id.
 *     Takes a row lock on every requested seat. Concurrent transactions queue
 *     here instead of racing. Ordering by seat_id gives every transaction the
 *     same lock acquisition order, which is what prevents deadlock when two
 *     people request overlapping multi-seat selections.
 *
 *  2. A guarded UPDATE whose WHERE clause IS the state machine.
 *     A seat is claimable only if it is AVAILABLE, or HELD past its deadline.
 *     We never read a status into JavaScript and then decide — the decision is
 *     made by the database, atomically, as part of the write.
 *
 *  3. rowcount as the verdict.
 *     If we did not update exactly the number of seats we asked for, someone
 *     else won at least one of them. We roll back and return 409.
 *
 * Exactly one transaction can observe the seat as claimable, so exactly one
 * hold succeeds. Overselling is not "unlikely" here; it is unrepresentable.
 */
export async function holdSeats(
  input: CreateHoldInput,
  ttlSeconds: number,
  idempotencyKey?: string,
): Promise<HoldResult & { replayed?: boolean }> {
  return withTransaction(async (c: PoolClient) => {
    // Bound how long a request will queue for a hot seat row (F8). Without
    // this, a request blocked on a violently contested seat holds one of the
    // pool's 10 connections forever — and browsing shares that same pool, so
    // one hammered showtime can starve everything else. SET LOCAL scopes it
    // to this transaction only. 55P03 (lock_not_available) is mapped to a
    // clean 503 by the error handler rather than hanging or 500ing.
    await c.query("SET LOCAL lock_timeout = '2s'");

    // --- 0. Idempotency replay (F19) -----------------------------------------
    // A retried request (double-tap, or a client retry after its first
    // response was lost) must not fight the user's own prior hold. If a live
    // HELD booking already exists under this key, hand it back unchanged
    // instead of attempting a second, independent hold.
    if (idempotencyKey) {
      const replay = await findLiveHoldByIdempotencyKey(c, idempotencyKey, ttlSeconds);
      if (replay) return replay;
    }

    // --- 1. Lock the contended rows, in a deterministic order ---------------
    const locked = await c.query<LockedSeat>(
      `SELECT ss.seat_id, ss.status, ss.price_cents, ss.hold_expires_at,
              ss.booking_id, s.row_label || s.col_num AS label
         FROM show_seats ss
         JOIN seats s ON s.id = ss.seat_id
        WHERE ss.showtime_id = $1 AND ss.seat_id = ANY($2::uuid[])
        ORDER BY ss.seat_id
          FOR UPDATE OF ss`,
      [input.showtime_id, input.seat_ids],
    );

    if (locked.rows.length !== input.seat_ids.length) {
      const found = new Set(locked.rows.map((r) => r.seat_id));
      throw NotFound(
        `Seat(s) not in this showtime: ${input.seat_ids.filter((id) => !found.has(id)).join(', ')}`,
      );
    }

    const amountCents = locked.rows.reduce((sum, r) => sum + r.price_cents, 0);

    // --- 2. Create the booking. The CHECK constraint on show_seats requires a
    //        booking_id before a seat may leave AVAILABLE, so this comes first.
    //        If the guarded UPDATE below loses, the whole thing rolls back.
    //
    //        clock_timestamp() here, not now() (F9): now() is frozen at
    //        transaction START, so a request that queued a while on the lock
    //        above would otherwise write an expiry computed from a stale
    //        clock — a hold born already short. clock_timestamp() reads the
    //        real time at the moment we actually grant it. (Comparisons
    //        against an EXISTING deadline, below and in the sweeper, keep
    //        using now() deliberately — that direction is conservative, not
    //        short: a queued loser sees a hold as newer than it really is, so
    //        it never wrongly steals one.)
    const bookingRef = newBookingRef();
    let inserted: { rows: Array<{ id: string; expires_at: string }> };
    // A SAVEPOINT here, not a bare try/catch: Postgres aborts the WHOLE
    // enclosing transaction on any statement error and refuses every further
    // command until an explicit ROLLBACK — including the fallback SELECT
    // below. Without the savepoint, that fallback query would itself fail
    // with 25P02 ("current transaction is aborted"), turning a recoverable
    // race into an opaque 500.
    await c.query('SAVEPOINT before_booking_insert');
    try {
      inserted = await c.query<{ id: string; expires_at: string }>(
        `INSERT INTO bookings
           (booking_ref, showtime_id, phone, status, amount_cents, expires_at, idempotency_key)
         VALUES ($1, $2, $3, 'HELD', $4, clock_timestamp() + make_interval(secs => $5), $6)
         RETURNING id, expires_at`,
        [bookingRef, input.showtime_id, input.phone, amountCents, ttlSeconds, idempotencyKey ?? null],
      );
    } catch (err) {
      // Lost a race against ourselves: another request with the SAME key
      // committed between our replay check and this insert. Hand back its
      // result rather than erroring — that IS the idempotent behaviour.
      if ((err as { code?: string }).code === '23505' && idempotencyKey) {
        await c.query('ROLLBACK TO SAVEPOINT before_booking_insert');
        const replay = await findLiveHoldByIdempotencyKey(c, idempotencyKey, ttlSeconds);
        if (replay) return replay;
      }
      throw err;
    }
    const booking = inserted.rows[0];

    // --- 3. The guarded transition. The WHERE clause is the rule. -----------
    const claimed = await c.query<{ seat_id: string }>(
      `UPDATE show_seats
          SET status = 'HELD',
              booking_id = $3,
              hold_expires_at = clock_timestamp() + make_interval(secs => $4)
        WHERE showtime_id = $1
          AND seat_id = ANY($2::uuid[])
          AND (status = 'AVAILABLE'
               OR (status = 'HELD' AND hold_expires_at < now()))
        RETURNING seat_id`,
      [input.showtime_id, input.seat_ids, booking.id, ttlSeconds],
    );

    // --- 4. rowcount is the verdict -----------------------------------------
    if (claimed.rows.length !== input.seat_ids.length) {
      const won = new Set(claimed.rows.map((r) => r.seat_id));
      const lost = locked.rows.filter((r) => !won.has(r.seat_id));
      throw Conflict('One or more seats are no longer available', {
        unavailable_seats: lost.map((r) => ({
          seat_id: r.seat_id,
          label: r.label,
          status: r.status === 'PENDING_PAYMENT' ? 'HELD' : r.status,
        })),
      });
    }

    // --- 5. Expire whoever we just took these seats from ---------------------
    // Claiming a timed-out seat and leaving its previous booking sitting at
    // HELD would leave that buyer's booking claiming a seat it no longer owns.
    // Doing it here, in the same transaction, means the two can never disagree
    // — and it does not wait for the sweeper.
    const previousOwners = [
      ...new Set(
        locked.rows
          .filter((r) => r.booking_id !== null && r.status === 'HELD')
          .map((r) => r.booking_id as string),
      ),
    ];
    if (previousOwners.length > 0) {
      await c.query(
        `UPDATE bookings SET status = 'EXPIRED', expires_at = NULL
          WHERE id = ANY($1::uuid[]) AND status = 'HELD'`,
        [previousOwners],
      );
    }

    return {
      booking_ref: bookingRef,
      showtime_id: input.showtime_id,
      status: 'HELD' as const,
      seats: locked.rows.map((r) => ({
        seat_id: r.seat_id,
        label: r.label,
        price_cents: r.price_cents,
      })),
      amount_cents: amountCents,
      expires_at: new Date(booking.expires_at).toISOString(),
      hold_ttl_seconds: ttlSeconds,
    };
  });
}

export type BookingDetail = {
  booking_ref: string;
  showtime_id: string;
  status: string;
  amount_cents: number;
  otp_verified: boolean;
  expires_at: string | null;
  created_at: string;
  movie_title: string;
  starts_at: string;
  seats: Array<{ seat_id: string; label: string; price_cents: number }>;
  payment_status: string | null;
};

/** One query, seats aggregated in Postgres. */
export async function findBookingByRef(ref: string): Promise<BookingDetail | null> {
  const rows = await query<BookingDetail>(
    `SELECT b.booking_ref, b.showtime_id, b.status, b.amount_cents,
            b.otp_verified, b.expires_at, b.created_at,
            m.title AS movie_title, st.starts_at,
            COALESCE(
              (SELECT json_agg(json_build_object(
                        'seat_id', s.id,
                        'label', s.row_label || s.col_num,
                        'price_cents', ss.price_cents) ORDER BY s.row_label, s.col_num)
                 FROM show_seats ss JOIN seats s ON s.id = ss.seat_id
                WHERE ss.booking_id = b.id),
              '[]'
            ) AS seats,
            (SELECT p.status FROM payments p
              WHERE p.booking_id = b.id
              ORDER BY p.created_at DESC LIMIT 1) AS payment_status
       FROM bookings b
       JOIN showtimes st ON st.id = b.showtime_id
       JOIN movies m     ON m.id  = st.movie_id
      WHERE b.booking_ref = $1`,
    [ref],
  );
  return rows[0] ?? null;
}

/**
 * F21: let a user who changed their mind return their seats immediately,
 * instead of waiting out the full TTL. Guarded the same way as every other
 * transition here — the WHERE clause is the only thing that decides.
 */
export async function releaseHold(ref: string): Promise<{ released: boolean; showtimeId: string | null }> {
  return withTransaction(async (c) => {
    const moved = await c.query<{ id: string; showtime_id: string }>(
      `UPDATE bookings SET status = 'EXPIRED', expires_at = NULL
        WHERE booking_ref = $1 AND status = 'HELD'
        RETURNING id, showtime_id`,
      [ref],
    );
    const booking = moved.rows[0];
    if (!booking) return { released: false, showtimeId: null };

    await c.query(
      `UPDATE show_seats SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
        WHERE booking_id = $1 AND status = 'HELD'`,
      [booking.id],
    );
    return { released: true, showtimeId: booking.showtime_id };
  });
}

/**
 * Expiry sweeper. Idempotent and safe to run concurrently with holds: the
 * WHERE clause only ever touches rows already past their deadline, and a hold
 * transaction holds a row lock on any seat it is claiming.
 *
 * Bounded to SWEEP_BATCH_SIZE per call (F10) — a mass expiry after a spike
 * must not become one transaction holding thousands of row locks for its
 * whole duration. SKIP LOCKED means the sweeper never queues behind a hold
 * transaction that is (rarely) touching the same row; it just picks up
 * whatever isn't currently in use and leaves the rest for the next tick.
 *
 * Returns how much it cleaned up, so the caller can decide whether to loop
 * for another batch, and the worker can log something meaningful.
 */
export async function sweepExpiredHolds(limit = SWEEP_BATCH_SIZE): Promise<{
  seats: number;
  bookings: number;
  showtimeIds: string[];
}> {
  return withTransaction(async (c) => {
    const seats = await c.query<{ showtime_id: string }>(
      `UPDATE show_seats
          SET status = 'AVAILABLE', booking_id = NULL, hold_expires_at = NULL
        WHERE (showtime_id, seat_id) IN (
          SELECT showtime_id, seat_id FROM show_seats
           WHERE status = 'HELD' AND hold_expires_at < now()
           LIMIT $1
             FOR UPDATE SKIP LOCKED
        )
        RETURNING showtime_id`,
      [limit],
    );
    const bookings = await c.query(
      `UPDATE bookings
          SET status = 'EXPIRED', expires_at = NULL
        WHERE id IN (
          SELECT id FROM bookings
           WHERE status = 'HELD' AND expires_at < now()
           LIMIT $1
             FOR UPDATE SKIP LOCKED
        )`,
      [limit],
    );
    return {
      seats: seats.rows.length,
      bookings: bookings.rowCount ?? 0,
      showtimeIds: [...new Set(seats.rows.map((r) => r.showtime_id))],
    };
  });
}
