import { query } from '../../lib/db';

export type MovieRow = {
  id: string;
  title: string;
  duration_min: number;
  rating: string | null;
  is_premiere: boolean;
  showtimes: Array<{
    id: string;
    starts_at: string;
    base_price_cents: number;
    hall_name: string;
    theatre_name: string;
  }>;
};

/**
 * Movies with their showtimes nested, in ONE query.
 *
 * The obvious implementation is a movie query plus a showtime query per movie —
 * a textbook N+1. Aggregating in Postgres keeps it at a single round trip
 * regardless of catalogue size.
 */
export async function listMoviesWithShowtimes(): Promise<MovieRow[]> {
  return query<MovieRow>(`
    SELECT m.id, m.title, m.duration_min, m.rating, m.is_premiere,
           COALESCE(
             json_agg(
               json_build_object(
                 'id', st.id,
                 'starts_at', st.starts_at,
                 'base_price_cents', st.base_price_cents,
                 'hall_name', h.name,
                 'theatre_name', t.name
               ) ORDER BY st.starts_at
             ) FILTER (WHERE st.id IS NOT NULL),
             '[]'
           ) AS showtimes
      FROM movies m
      LEFT JOIN showtimes st ON st.movie_id = m.id
      LEFT JOIN halls h      ON h.id  = st.hall_id
      LEFT JOIN theatres t   ON t.id  = h.theatre_id
     GROUP BY m.id
     ORDER BY m.is_premiere DESC, m.title
  `);
}

export type SeatMapRow = {
  seat_id: string;
  row_label: string;
  col_num: number;
  status: string;
  price_cents: number;
  hold_live: boolean;
  movie_title: string;
  hall_name: string;
  theatre_name: string;
  starts_at: string;
  seat_rows: number;
  seat_cols: number;
};

/**
 * Seat map for one showtime.
 *
 * `hold_live` applies expiry LAZILY: a hold whose deadline has passed is
 * reported as available even if the sweeper has not run yet. The map therefore
 * tells the truth about what a buyer can actually claim, and stays correct
 * with the worker stopped.
 */
export async function fetchSeatMap(showtimeId: string): Promise<SeatMapRow[]> {
  return query<SeatMapRow>(
    `SELECT s.id AS seat_id, s.row_label, s.col_num,
            ss.status, ss.price_cents,
            (ss.hold_expires_at IS NULL OR ss.hold_expires_at > now()) AS hold_live,
            m.title AS movie_title, h.name AS hall_name, t.name AS theatre_name,
            st.starts_at, h.seat_rows, h.seat_cols
       FROM show_seats ss
       JOIN seats s     ON s.id  = ss.seat_id
       JOIN showtimes st ON st.id = ss.showtime_id
       JOIN movies m    ON m.id  = st.movie_id
       JOIN halls h     ON h.id  = st.hall_id
       JOIN theatres t  ON t.id  = h.theatre_id
      WHERE ss.showtime_id = $1
      ORDER BY s.row_label, s.col_num`,
    [showtimeId],
  );
}
