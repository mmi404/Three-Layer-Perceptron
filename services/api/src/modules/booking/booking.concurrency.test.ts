import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { pool, query, waitForDatabase } from '../../lib/db';
import { AppError } from '../../lib/errors';
import { holdSeats, sweepExpiredHolds } from './booking.repo';

/**
 * ============================================================================
 *  INTEGRATION TEST — Scenario A, in miniature, against a real Postgres.
 * ============================================================================
 *
 * This is the test that matters. Mocking the database here would prove
 * nothing: the entire correctness argument rests on Postgres row locks and a
 * guarded UPDATE, so the database IS the unit under test.
 *
 * Fixtures are self-contained (their own theatre/hall/showtime) and torn down
 * afterwards, so this can run against a live dev database without disturbing
 * the seed data.
 */

const CONCURRENCY = 50;

let showtimeId: string;
let seatIds: string[];
let theatreId: string;

beforeAll(async () => {
  await waitForDatabase();

  const [theatre] = await query<{ id: string }>(
    `INSERT INTO theatres (name, city) VALUES ('__test_theatre', 'test') RETURNING id`,
  );
  theatreId = theatre.id;

  const [hall] = await query<{ id: string }>(
    `INSERT INTO halls (theatre_id, name, seat_rows, seat_cols)
     VALUES ($1, 'test-hall', 1, 3) RETURNING id`,
    [theatreId],
  );

  const seats = await query<{ id: string }>(
    `INSERT INTO seats (hall_id, row_label, col_num)
     VALUES ($1,'Z',1), ($1,'Z',2), ($1,'Z',3) RETURNING id`,
    [hall.id],
  );
  seatIds = seats.map((s) => s.id);

  const [movie] = await query<{ id: string }>(
    `INSERT INTO movies (title, duration_min) VALUES ('__test_movie', 100) RETURNING id`,
  );
  const [showtime] = await query<{ id: string }>(
    `INSERT INTO showtimes (movie_id, hall_id, starts_at, base_price_cents)
     VALUES ($1, $2, now() + interval '1 day', 40000) RETURNING id`,
    [movie.id, hall.id],
  );
  showtimeId = showtime.id;

  await query(
    `INSERT INTO show_seats (showtime_id, seat_id, price_cents)
     SELECT $1, unnest($2::uuid[]), 40000`,
    [showtimeId, seatIds],
  );
});

afterAll(async () => {
  // Order matters: show_seats references bookings, bookings reference showtimes.
  await query(`DELETE FROM show_seats WHERE showtime_id = $1`, [showtimeId]);
  await query(`DELETE FROM payments WHERE booking_id IN
                 (SELECT id FROM bookings WHERE showtime_id = $1)`, [showtimeId]);
  await query(`DELETE FROM bookings WHERE showtime_id = $1`, [showtimeId]);
  await query(`DELETE FROM showtimes WHERE id = $1`, [showtimeId]);
  await query(`DELETE FROM movies WHERE title = '__test_movie'`);
  await query(`DELETE FROM seats WHERE hall_id IN
                 (SELECT id FROM halls WHERE theatre_id = $1)`, [theatreId]);
  await query(`DELETE FROM halls WHERE theatre_id = $1`, [theatreId]);
  await query(`DELETE FROM theatres WHERE id = $1`, [theatreId]);
  await pool.end();
});

async function resetSeats() {
  await query(
    `UPDATE show_seats SET status='AVAILABLE', booking_id=NULL, hold_expires_at=NULL
      WHERE showtime_id = $1`,
    [showtimeId],
  );
  await query(`DELETE FROM bookings WHERE showtime_id = $1`, [showtimeId]);
}

describe('one seat, many buyers', () => {
  it(`survives ${CONCURRENCY} simultaneous holds on the same seat with zero oversell`, async () => {
    await resetSeats();
    const contendedSeat = seatIds[0];

    // All requests dispatched before any of them is awaited — a real burst,
    // not a sequential loop wearing a costume.
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        holdSeats(
          { showtime_id: showtimeId, seat_ids: [contendedSeat], phone: `+8801700000${i}` },
          120,
        ),
      ),
    );

    const won = results.filter((r) => r.status === 'fulfilled');
    const lost = results.filter((r) => r.status === 'rejected');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(CONCURRENCY - 1);

    // Every loser must be a clean 409, never a crash, a deadlock or a timeout.
    for (const r of lost) {
      const reason = (r as PromiseRejectedResult).reason;
      expect(reason).toBeInstanceOf(AppError);
      expect((reason as AppError).statusCode).toBe(409);
    }

    // OVERSELL CHECK: the seat is held exactly once, by exactly one booking.
    const [seat] = await query<{ status: string; booking_id: string | null }>(
      `SELECT status, booking_id FROM show_seats WHERE showtime_id=$1 AND seat_id=$2`,
      [showtimeId, contendedSeat],
    );
    expect(seat.status).toBe('HELD');
    expect(seat.booking_id).not.toBeNull();

    const [{ count }] = await query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM show_seats
        WHERE showtime_id=$1 AND seat_id=$2 AND status <> 'AVAILABLE'`,
      [showtimeId, contendedSeat],
    );
    expect(count).toBe('1');
  }, 30_000);

  it('gives each of three buyers a different seat when they ask for different seats', async () => {
    await resetSeats();
    const results = await Promise.allSettled(
      seatIds.map((id, i) =>
        holdSeats({ showtime_id: showtimeId, seat_ids: [id], phone: `+8801711111${i}` }, 120),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
  });

  it('is all-or-nothing for a multi-seat request', async () => {
    await resetSeats();
    // Buyer 1 takes the middle seat.
    await holdSeats({ showtime_id: showtimeId, seat_ids: [seatIds[1]], phone: '+8801722222' }, 120);

    // Buyer 2 wants all three. They must get none of them.
    await expect(
      holdSeats({ showtime_id: showtimeId, seat_ids: seatIds, phone: '+8801733333' }, 120),
    ).rejects.toBeInstanceOf(AppError);

    const rows = await query<{ status: string }>(
      `SELECT status FROM show_seats WHERE showtime_id=$1 ORDER BY seat_id`,
      [showtimeId],
    );
    // Exactly one seat held — the partial claim was rolled back.
    expect(rows.filter((r) => r.status === 'HELD')).toHaveLength(1);
  });

  it('does not deadlock when two buyers request overlapping seats in opposite order', async () => {
    await resetSeats();
    // Deterministic lock ordering (ORDER BY seat_id FOR UPDATE) is what makes
    // this safe; without it these two transactions can deadlock.
    const forward = [seatIds[0], seatIds[1]];
    const reverse = [seatIds[1], seatIds[0]];

    const results = await Promise.allSettled([
      holdSeats({ showtime_id: showtimeId, seat_ids: forward, phone: '+8801744444' }, 120),
      holdSeats({ showtime_id: showtimeId, seat_ids: reverse, phone: '+8801755555' }, 120),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results.filter((x) => x.status === 'rejected')) {
      // A 409 is correct. A Postgres deadlock error (40P01) is not.
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(AppError);
    }
  });
});

describe('abandoned holds', () => {
  it('lets a second buyer claim a seat whose hold has expired', async () => {
    await resetSeats();
    const seat = seatIds[0];

    // Buyer 1 holds with an already-elapsed TTL.
    const first = await holdSeats(
      { showtime_id: showtimeId, seat_ids: [seat], phone: '+8801766666' },
      -5,
    );
    expect(first.booking_ref).toMatch(/^bk_[0-9a-f]{12}$/);

    // Buyer 2 claims it WITHOUT the sweeper having run — lazy expiry.
    const second = await holdSeats(
      { showtime_id: showtimeId, seat_ids: [seat], phone: '+8801777777' },
      120,
    );
    expect(second.booking_ref).not.toBe(first.booking_ref);

    const [row] = await query<{ status: string; booking_id: string }>(
      `SELECT status, booking_id FROM show_seats WHERE showtime_id=$1 AND seat_id=$2`,
      [showtimeId, seat],
    );
    expect(row.status).toBe('HELD');

    const [owner] = await query<{ booking_ref: string }>(
      `SELECT booking_ref FROM bookings WHERE id = $1`,
      [row.booking_id],
    );
    expect(owner.booking_ref).toBe(second.booking_ref);

    // ...and buyer 1's booking is marked EXPIRED in the SAME transaction that
    // took the seat away, not eventually by the sweeper. Otherwise a dead
    // worker would leave buyer 1 believing they still hold a seat they lost.
    const [loser] = await query<{ status: string }>(
      `SELECT status FROM bookings WHERE booking_ref = $1`,
      [first.booking_ref],
    );
    expect(loser.status).toBe('EXPIRED');
  });

  it('sweeper releases expired holds and marks the booking EXPIRED', async () => {
    await resetSeats();
    const seat = seatIds[2];
    const abandoned = await holdSeats(
      { showtime_id: showtimeId, seat_ids: [seat], phone: '+8801788888' },
      -5,
    );

    const swept = await sweepExpiredHolds();
    expect(swept.seats).toBeGreaterThanOrEqual(1);

    const [row] = await query<{ status: string; booking_id: string | null }>(
      `SELECT status, booking_id FROM show_seats WHERE showtime_id=$1 AND seat_id=$2`,
      [showtimeId, seat],
    );
    expect(row.status).toBe('AVAILABLE');
    expect(row.booking_id).toBeNull();

    const [booking] = await query<{ status: string }>(
      `SELECT status FROM bookings WHERE booking_ref = $1`,
      [abandoned.booking_ref],
    );
    expect(booking.status).toBe('EXPIRED');
  });
});
