import { pool, waitForDatabase, withTransaction } from '../lib/db';
import { logger } from '../lib/logger';

/**
 * Demo data. Idempotent — safe to run on every `docker compose up`.
 *
 * Halls are 8 rows (A-H) x 12 columns, so seat **F12** from the problem
 * statement genuinely exists. That is the seat the load test fights over.
 */

const ROWS = 8;   // A..H
const COLS = 12;  // 1..12
const PREMIERE_TITLE = 'Spider-Man: Brand New Day';

const MOVIES = [
  { title: PREMIERE_TITLE, duration_min: 128, rating: 'PG-13', premiere: true },
  { title: 'Dune: Part Three', duration_min: 155, rating: 'PG-13', premiere: false },
  { title: 'The Quiet Harbour', duration_min: 97, rating: 'PG', premiere: false },
];

function rowLabel(i: number): string {
  return String.fromCharCode(65 + i); // 0 -> 'A'
}

/** Front rows cost more. Keeps pricing visible without complicating the model. */
function priceFor(base: number, row: string): number {
  return row <= 'B' ? Math.round(base * 1.25) : base;
}

async function seed(): Promise<void> {
  await waitForDatabase();

  const { rows: existing } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM showtimes',
  );
  if (Number(existing[0]?.count ?? 0) > 0) {
    logger.info('Database already seeded, skipping');
    return;
  }

  await withTransaction(async (c) => {
    // --- theatre + halls ----------------------------------------------------
    const { rows: [theatre] } = await c.query<{ id: string }>(
      `INSERT INTO theatres (name, city) VALUES ($1, $2) RETURNING id`,
      ['Star Cineplex', 'Chattogram'],
    );

    const hallIds: string[] = [];
    for (const name of ['Hall 1', 'Hall 2']) {
      const { rows: [hall] } = await c.query<{ id: string }>(
        `INSERT INTO halls (theatre_id, name, seat_rows, seat_cols)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [theatre!.id, name, ROWS, COLS],
      );
      hallIds.push(hall!.id);

      // Bulk-insert seats: one statement, not ROWS*COLS round trips.
      const values: string[] = [];
      const params: unknown[] = [hall!.id];
      let n = 1;
      for (let r = 0; r < ROWS; r++) {
        for (let col = 1; col <= COLS; col++) {
          params.push(rowLabel(r), col);
          values.push(`($1, $${++n}, $${++n})`);
        }
      }
      await c.query(
        `INSERT INTO seats (hall_id, row_label, col_num) VALUES ${values.join(',')}`,
        params,
      );
    }

    // --- movies -------------------------------------------------------------
    const movieIds: Record<string, string> = {};
    for (const m of MOVIES) {
      const { rows: [row] } = await c.query<{ id: string }>(
        `INSERT INTO movies (title, duration_min, rating, is_premiere)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [m.title, m.duration_min, m.rating, m.premiere],
      );
      movieIds[m.title] = row!.id;
    }

    // --- showtimes ----------------------------------------------------------
    // The premiere is first and sits in Hall 1 — that is the one under attack.
    const now = new Date();
    const at = (hoursFromNow: number) =>
      new Date(now.getTime() + hoursFromNow * 3600_000);

    const plan: Array<{ title: string; hall: number; hours: number; price: number }> = [
      { title: PREMIERE_TITLE, hall: 0, hours: 3, price: 45000 },  // premiere
      { title: PREMIERE_TITLE, hall: 1, hours: 6, price: 35000 },
      { title: 'Dune: Part Three', hall: 0, hours: 9, price: 30000 },
      { title: 'Dune: Part Three', hall: 1, hours: 12, price: 30000 },
      { title: 'The Quiet Harbour', hall: 0, hours: 27, price: 25000 },
      { title: 'The Quiet Harbour', hall: 1, hours: 30, price: 25000 },
    ];

    for (const p of plan) {
      const { rows: [st] } = await c.query<{ id: string }>(
        `INSERT INTO showtimes (movie_id, hall_id, starts_at, base_price_cents)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [movieIds[p.title], hallIds[p.hall], at(p.hours).toISOString(), p.price],
      );

      // One show_seats row per seat in that hall. Set-based, no N+1.
      await c.query(
        `INSERT INTO show_seats (showtime_id, seat_id, status, price_cents)
         SELECT $1, s.id, 'AVAILABLE',
                CASE WHEN s.row_label <= 'B' THEN ROUND($3::numeric * 1.25)::int
                     ELSE $3::int END
           FROM seats s WHERE s.hall_id = $2`,
        [st!.id, hallIds[p.hall], p.price],
      );
    }
  });

  const { rows: [summary] } = await pool.query<Record<string, string>>(
    `SELECT (SELECT COUNT(*)::text FROM movies)     AS movies,
            (SELECT COUNT(*)::text FROM showtimes)  AS showtimes,
            (SELECT COUNT(*)::text FROM seats)      AS seats,
            (SELECT COUNT(*)::text FROM show_seats) AS show_seats`,
  );
  logger.info(summary, 'Seed complete');
}

// Exported for the price helper's unit test; not used by the seed path itself.
export { priceFor, rowLabel };

if (require.main === module) {
  seed()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => {
      logger.fatal({ err }, 'Seed failed');
      process.exit(1);
    });
}
