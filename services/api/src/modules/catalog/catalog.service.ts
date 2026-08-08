import { redis } from '../../lib/redis';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { NotFound } from '../../lib/errors';
import * as repo from './catalog.repo';
import { projectSeatStatus } from './catalog.rules';
import type { SeatMap, SeatMapEntry } from './catalog.schema';

const SEATMAP_KEY = (id: string) => `seatmap:${id}`;

export async function listMovies() {
  return repo.listMoviesWithShowtimes();
}

/**
 * Seat map, with a very short read-through cache.
 *
 * The TTL is ~1 second and every seat-state change busts the key (see
 * invalidateSeatMap). Under a premiere rush hundreds of clients poll the same
 * showtime; this collapses that into roughly one query per second per showtime
 * without ever showing state older than the TTL.
 *
 * Redis being unavailable degrades to a direct query — it must never break
 * browsing.
 */
export async function getSeatMap(showtimeId: string): Promise<SeatMap> {
  const key = SEATMAP_KEY(showtimeId);

  if (env.SEATMAP_CACHE_MS > 0) {
    try {
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit) as SeatMap;
    } catch (err) {
      logger.warn({ err }, 'Seat map cache read failed, falling through to Postgres');
    }
  }

  const rows = await repo.fetchSeatMap(showtimeId);
  if (rows.length === 0) throw NotFound('Showtime');

  const first = rows[0];
  const seats: SeatMapEntry[] = rows.map((r) => ({
    seat_id: r.seat_id,
    row: r.row_label,
    col: r.col_num,
    label: `${r.row_label}${r.col_num}`,
    status: projectSeatStatus(r.status, r.hold_live),
    price_cents: r.price_cents,
  }));

  const summary = { available: 0, held: 0, booked: 0 };
  for (const s of seats) summary[s.status]++;

  const map: SeatMap = {
    showtime: {
      id: showtimeId,
      movie_title: first.movie_title,
      hall_name: first.hall_name,
      theatre_name: first.theatre_name,
      starts_at: first.starts_at,
      rows: first.seat_rows,
      cols: first.seat_cols,
    },
    seats,
    summary,
  };

  if (env.SEATMAP_CACHE_MS > 0) {
    try {
      await redis.set(key, JSON.stringify(map), 'PX', env.SEATMAP_CACHE_MS);
    } catch (err) {
      logger.warn({ err }, 'Seat map cache write failed');
    }
  }

  return map;
}

/**
 * Call after ANY seat-state change. Cheap, and the reason a 1s TTL does not
 * mean 1s of stale data after a booking.
 */
export async function invalidateSeatMap(showtimeId: string): Promise<void> {
  try {
    await redis.del(SEATMAP_KEY(showtimeId));
  } catch (err) {
    logger.warn({ err, showtimeId }, 'Seat map cache invalidation failed');
  }
}
