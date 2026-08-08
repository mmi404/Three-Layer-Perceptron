import { z } from 'zod';

/**
 * JUDGING HOOK: POST /api/v1/holds. Documented verbatim in the README.
 * Do not rename the route or these field names.
 */
export const createHoldSchema = z.object({
  showtime_id: z.string().uuid('showtime_id must be a uuid'),
  seat_ids: z
    .array(z.string().uuid('each seat id must be a uuid'))
    .min(1, 'at least one seat is required')
    .max(10, 'at most 10 seats per booking')
    // Duplicates in one request would otherwise inflate the amount and make
    // the rowcount check disagree with the request. Reject them explicitly.
    .refine((ids) => new Set(ids).size === ids.length, {
      message: 'seat_ids must not contain duplicates',
    }),
  phone: z
    .string()
    .trim()
    .min(6, 'phone is required')
    .max(20)
    .regex(/^\+?[0-9]+$/, 'phone must be digits, optionally starting with +'),
});

export const bookingRefParam = z.object({
  ref: z.string().regex(/^bk_[0-9a-f]{12}$/, 'invalid booking reference'),
});

export type CreateHoldInput = z.infer<typeof createHoldSchema>;

export type BookingStatus =
  | 'HELD'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'FAILED'
  | 'EXPIRED';

export type HoldResult = {
  booking_ref: string;
  showtime_id: string;
  status: BookingStatus;
  seats: Array<{ seat_id: string; label: string; price_cents: number }>;
  amount_cents: number;
  expires_at: string;
  hold_ttl_seconds: number;
};
