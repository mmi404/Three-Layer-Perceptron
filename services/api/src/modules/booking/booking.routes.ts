import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import * as service from './booking.service';
import { bookingRefParam, createHoldSchema } from './booking.schema';

export const bookingRouter = Router();

/**
 * POST /api/v1/holds
 *
 * JUDGING HOOK: documented verbatim in the README. Do not rename.
 *
 *   201 -> the hold is yours, with an expires_at
 *   200 -> an Idempotency-Key you already used is replayed, unchanged (F19)
 *   409 -> someone else got there first; details.unavailable_seats says which
 *   404 -> those seats are not part of that showtime
 *   422 -> malformed request
 *
 * An optional `Idempotency-Key` header makes a retry (double-tap, or a client
 * retry after a timeout) return the caller's OWN prior hold instead of a
 * fresh, independent attempt that would 409 against it.
 */
bookingRouter.post(
  '/holds',
  asyncHandler(async (req, res) => {
    const input = createHoldSchema.parse(req.body);
    const idempotencyKey = idempotencyKeyOf(req.header('idempotency-key'));
    const result = await service.createHold(input, idempotencyKey);
    const { replayed, ...body } = result;
    res.status(replayed ? 200 : 201).json(body);
  }),
);

/** GET /api/v1/bookings/:ref — the client polls this after paying. */
bookingRouter.get(
  '/bookings/:ref',
  asyncHandler(async (req, res) => {
    const { ref } = bookingRefParam.parse(req.params);
    res.json(await service.getBooking(ref));
  }),
);

/**
 * DELETE /api/v1/holds/:ref (F21)
 *
 * Give the seats back immediately instead of making a user who changed their
 * mind wait out the full TTL. 204 on success, 404 if the booking is not a
 * live hold (already paid, expired, or never existed).
 */
bookingRouter.delete(
  '/holds/:ref',
  asyncHandler(async (req, res) => {
    const { ref } = bookingRefParam.parse(req.params);
    await service.releaseHold(ref);
    res.status(204).end();
  }),
);

function idempotencyKeyOf(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return undefined;
  return trimmed;
}
