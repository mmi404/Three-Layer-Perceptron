-- =============================================================================
--  001_init — CinemaSeat baseline schema
--
--  Design note for the defence round: `show_seats` is the serialization point
--  of the entire system. One row per (showtime, seat). Every seat-state change
--  is a guarded UPDATE against that row, so Postgres — not application code,
--  not Redis — decides who wins a contested seat.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- --- Catalog -----------------------------------------------------------------

CREATE TABLE movies (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title        text NOT NULL,
  duration_min int  NOT NULL CHECK (duration_min > 0),
  rating       text,
  poster_url   text,
  is_premiere  boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE theatres (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  city text NOT NULL
);

CREATE TABLE halls (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  theatre_id uuid NOT NULL REFERENCES theatres(id) ON DELETE CASCADE,
  name       text NOT NULL,
  seat_rows  int  NOT NULL CHECK (seat_rows  > 0),
  seat_cols  int  NOT NULL CHECK (seat_cols  > 0),
  UNIQUE (theatre_id, name)
);

CREATE TABLE seats (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hall_id   uuid NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  row_label text NOT NULL,
  col_num   int  NOT NULL CHECK (col_num > 0),
  UNIQUE (hall_id, row_label, col_num)
);

CREATE TABLE showtimes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movie_id         uuid NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
  hall_id          uuid NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
  starts_at        timestamptz NOT NULL,
  base_price_cents int NOT NULL CHECK (base_price_cents >= 0),
  UNIQUE (hall_id, starts_at)
);
CREATE INDEX showtimes_movie_idx ON showtimes (movie_id, starts_at);

-- --- Booking -----------------------------------------------------------------

-- A hold IS a booking. HELD is simply a booking that carries an expiry.
-- One table, one state machine, no reconciliation between two sources of truth.
CREATE TABLE bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ref  text NOT NULL UNIQUE,
  showtime_id  uuid NOT NULL REFERENCES showtimes(id),
  phone        text NOT NULL,
  status       text NOT NULL DEFAULT 'HELD'
               CHECK (status IN ('HELD','PENDING_PAYMENT','CONFIRMED','FAILED','EXPIRED')),
  amount_cents int  NOT NULL CHECK (amount_cents >= 0),
  otp_verified boolean NOT NULL DEFAULT false,
  expires_at   timestamptz,          -- non-null only while HELD
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_expiry_idx ON bookings (status, expires_at)
  WHERE status = 'HELD';

-- THE contended table. Composite PK means one row per seat per showtime, and
-- that row is what concurrent buyers fight over.
CREATE TABLE show_seats (
  showtime_id     uuid NOT NULL REFERENCES showtimes(id) ON DELETE CASCADE,
  seat_id         uuid NOT NULL REFERENCES seats(id)     ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'AVAILABLE'
                  CHECK (status IN ('AVAILABLE','HELD','PENDING_PAYMENT','BOOKED')),
  price_cents     int  NOT NULL CHECK (price_cents >= 0),
  booking_id      uuid REFERENCES bookings(id) ON DELETE SET NULL,
  hold_expires_at timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (showtime_id, seat_id),

  -- A seat that is not AVAILABLE must belong to a booking. Makes an orphaned
  -- hold structurally impossible rather than merely unlikely.
  CONSTRAINT held_seats_have_a_booking
    CHECK (status = 'AVAILABLE' OR booking_id IS NOT NULL)
);
CREATE INDEX show_seats_booking_idx ON show_seats (booking_id);
-- Serves the expiry sweeper: partial index, so it stays tiny.
CREATE INDEX show_seats_expiry_idx ON show_seats (hold_expires_at)
  WHERE status = 'HELD';

-- --- Payment -----------------------------------------------------------------

CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id         uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  booking_ref        text NOT NULL,
  gateway_payment_id text UNIQUE,     -- from /charge, or first seen on callback
  status             text NOT NULL DEFAULT 'INITIATED'
                     CHECK (status IN ('INITIATED','PENDING','SUCCEEDED','FAILED',
                                       'REFUND_PENDING','REFUNDED')),
  amount_cents       int  NOT NULL CHECK (amount_cents >= 0),
  attempts           int  NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_booking_ref_idx ON payments (booking_ref);
-- Structural guarantee against double-charging one booking: at most one
-- payment in a live state. A concurrent second /pay hits a 23505, not a race.
CREATE UNIQUE INDEX one_live_payment_per_booking ON payments (booking_id)
  WHERE status IN ('INITIATED','PENDING','SUCCEEDED');
-- Serves the payment-timeout sweeper.
CREATE INDEX payments_pending_idx ON payments (created_at)
  WHERE status IN ('INITIATED','PENDING');

-- The idempotency ledger. The gateway delivers ~8% of callbacks twice; the
-- primary key is what makes the second delivery a no-op.
CREATE TABLE payment_events (
  event_id    text PRIMARY KEY,
  booking_ref text,
  status      text,
  payload     jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

-- --- updated_at maintenance ---------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_set_updated_at   BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER show_seats_set_updated_at BEFORE UPDATE ON show_seats
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER payments_set_updated_at   BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
