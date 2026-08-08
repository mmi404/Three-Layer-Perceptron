import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import * as service from './catalog.service';
import { showtimeIdParam } from './catalog.schema';

export const catalogRouter = Router();

/** GET /api/v1/movies — browse. Never touches the payment gateway. */
catalogRouter.get(
  '/movies',
  asyncHandler(async (_req, res) => {
    res.json({ data: await service.listMovies() });
  }),
);

/**
 * GET /api/v1/showtimes/:id/seats — the live seat map.
 * JUDGING HOOK: documented verbatim in the README. Do not rename.
 */
catalogRouter.get(
  '/showtimes/:id/seats',
  asyncHandler(async (req, res) => {
    const { id } = showtimeIdParam.parse(req.params);
    res.json(await service.getSeatMap(id));
  }),
);
