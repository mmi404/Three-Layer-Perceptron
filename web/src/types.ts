export type Showtime = {
  id: string;
  starts_at: string;
  base_price_cents: number;
  hall_name: string;
  theatre_name: string;
};

export type Movie = {
  id: string;
  title: string;
  duration_min: number;
  rating: string | null;
  is_premiere: boolean;
  showtimes: Showtime[];
};

export type SeatStatus = 'available' | 'held' | 'booked';

export type Seat = {
  seat_id: string;
  row: string;
  col: number;
  label: string;
  status: SeatStatus;
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
  seats: Seat[];
  summary: { available: number; held: number; booked: number };
};

export type Hold = {
  booking_ref: string;
  showtime_id: string;
  status: string;
  seats: Array<{ seat_id: string; label: string; price_cents: number }>;
  amount_cents: number;
  expires_at: string;
  hold_ttl_seconds: number;
};

export type Booking = {
  booking_ref: string;
  status: 'HELD' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'FAILED' | 'EXPIRED';
  amount_cents: number;
  otp_verified: boolean;
  expires_at: string | null;
  movie_title: string;
  starts_at: string;
  seats: Array<{ seat_id: string; label: string; price_cents: number }>;
  payment_status: string | null;
};

export const taka = (cents: number) => `৳${(cents / 100).toFixed(0)}`;
