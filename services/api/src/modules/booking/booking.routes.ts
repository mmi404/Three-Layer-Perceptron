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
 *   409 -> someone else got there first; details.unavailable_seats says which
 *   404 -> those seats are not part of that showtime
 *   422 -> malformed request
 */
bookingRouter.post(
  '/holds',
  asyncHandler(async (req, res) => {
    const input = createHoldSchema.parse(req.body);
    res.status(201).json(await service.createHold(input));
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
