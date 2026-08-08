-- =============================================================================
--  002_fix_backlog — schema changes from the post-hackathon review
--  (see FIX-BACKLOG.md). Forward-only, like 001.
-- =============================================================================

-- F19: idempotency for POST /holds. A client-supplied key, unique only among
-- LIVE holds — once a hold resolves (paid, expired, failed) the same key is
-- free to be reused for an unrelated future booking.
ALTER TABLE bookings ADD COLUMN idempotency_key text;
CREATE UNIQUE INDEX bookings_idempotency_key_idx ON bookings (idempotency_key)
  WHERE idempotency_key IS NOT NULL AND status = 'HELD';

-- Refund terminal state: /refund can fail PERMANENTLY (404 unknown payment,
-- 409 NOT_REFUNDABLE), not just transiently. Without a terminal state the
-- reconciler retries a permanent failure forever. refund_attempts is separate
-- from payments.attempts (which counts /charge attempts, a different thing).
ALTER TABLE payments DROP CONSTRAINT payments_status_check;
ALTER TABLE payments ADD CONSTRAINT payments_status_check
  CHECK (status IN ('INITIATED','PENDING','SUCCEEDED','FAILED',
                     'REFUND_PENDING','REFUNDED','REFUND_FAILED'));
ALTER TABLE payments ADD COLUMN refund_attempts int NOT NULL DEFAULT 0;
