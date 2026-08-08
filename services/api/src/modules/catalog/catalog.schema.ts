import { z } from 'zod';

export const showtimeIdParam = z.object({
  id: z.string().uuid('showtime id must be a uuid'),
});

/** What the seat map exposes. Internal states are collapsed deliberately. */
export type PublicSeatStatus = 'available' | 'held' | 'booked';

export type SeatMapEntry = {
  seat_id: string;
  row: string;
  col: number;
  label: string;
  status: PublicSeatStatus;
  price_cents: number;
};

export type SeatMap = {
  showtime: {
    id: string;
    movie_title: string;
    hall_name: string;
    theatre_name: string;
    starts_at: string;
    rows: number;
    cols: number;
  };
  seats: SeatMapEntry[];
  summary: { available: number; held: number; booked: number };
};
