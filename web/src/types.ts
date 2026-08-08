export interface Showtime {
  id: string;
  starts_at: string;
  base_price_cents: number;
  hall_name: string;
  theatre_name: string;
  movie_id?: string;
  screen_name?: string;
  start_time?: string;
  price_amount?: number;
  movie_title?: string;
  poster_url?: string;
  duration_mins?: number;
  genre?: string;
  rating?: string;
  theatre_id?: string;
  location?: string;
}

export interface Movie {
  id: string;
  title: string;
  duration_min: number;
  rating: string | null;
  is_premiere: boolean;
  showtimes: Showtime[];
  description?: string;
  poster_url?: string;
  duration_mins?: number;
  genre?: string;
  release_date?: string;
  imdb_rating?: number;
  badge?: 'HOT RUSH' | 'FEATURED' | 'IMAX 3D' | 'PREMIERE' | 'DOLBY ATMOS';
}

export type SeatStatus = 'available' | 'held' | 'booked' | 'AVAILABLE' | 'HELD' | 'BOOKED';

export interface Seat {
  id?: string;
  seat_id?: string;
  row?: string;
  col?: number;
  row_label?: string;
  seat_number?: number;
  seat_code?: string;
  label?: string;
  status: SeatStatus;
  price_cents?: number;
  held_by_user_id?: string | null;
  hold_expires_at?: string | null;
  booking_ref?: string | null;
  showtime_id?: string;
}

export interface SeatMap {
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
}

export interface Hold {
  booking_ref: string;
  showtime_id: string;
  status: string;
  seats: Array<{ seat_id: string; label: string; price_cents: number }>;
  amount_cents: number;
  expires_at: string;
  hold_ttl_seconds: number;
}

export interface SnackItem {
  id: string;
  name: string;
  category: 'Popcorn' | 'Drinks' | 'Combos' | 'Snacks';
  price: number;
  image_url: string;
  quantity: number;
  badge?: string;
}

export interface Booking {
  id?: string;
  booking_ref: string;
  status: 'HELD' | 'PENDING' | 'PENDING_PAYMENT' | 'CONFIRMED' | 'FAILED' | 'EXPIRED' | 'CANCELLED';
  amount_cents?: number;
  amount?: number;
  otp_verified?: boolean;
  expires_at?: string | null;
  movie_title?: string;
  starts_at?: string;
  seats?: Array<{ seat_id: string; label: string; price_cents: number }>;
  payment_status?: string | null;
  user_phone?: string;
  seat_code?: string;
  screen_name?: string;
  created_at?: string;
  snacks?: SnackItem[];
}

export interface CinemaBranch {
  id: string;
  name: string;
  city: string;
  location: string;
  formats: string[];
  totalScreens: number;
}

export interface ReviewItem {
  id: string;
  movie_id: string;
  author_name: string;
  rating: number;
  comment: string;
  verified_purchaser: boolean;
  created_at: string;
  isNew?: boolean;
}

export const taka = (cents: number) => `৳${(cents / 100).toFixed(0)}`;
