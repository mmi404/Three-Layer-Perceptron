import { Router } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import * as service from './items.service';
import {
  createItemSchema,
  idParamSchema,
  listItemsSchema,
  updateItemSchema,
} from './items.schema';

/**
 * Routes: HTTP only. Parse -> delegate -> respond.
 * No business logic here. If you find yourself writing an `if` about the
 * domain in this file, it belongs in items.service.ts.
 */
export const itemsRouter = Router();

// CREATE
itemsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createItemSchema.parse(req.body); // throws ZodError -> 422
    const item = await service.createItem(input);
    res.status(201).json({ data: item });
  }),
);

// LIST (paginated — never unbounded)
itemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = listItemsSchema.parse(req.query);
    const { items, nextCursor } = await service.listItemsPaged(q);
    res.json({ data: items, pagination: { nextCursor, limit: q.limit } });
  }),
);

// READ
itemsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    res.json({ data: await service.getItem(id) });
  }),
);

// UPDATE
itemsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    const input = updateItemSchema.parse(req.body);
    res.json({ data: await service.updateItemDetails(id, input) });
  }),
);

// DELETE
itemsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = idParamSchema.parse(req.params);
    await service.removeItem(id);
    res.status(204).send();
  }),
);
