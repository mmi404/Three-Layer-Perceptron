import { Conflict, NotFound } from '../../lib/errors';
import { cached, invalidate } from '../../lib/redis';
import { enqueue } from '../../lib/queue';
import * as repo from './items.repo';
import { ALLOWED_TRANSITIONS, canTransition } from './items.rules';
import type {
  CreateItemInput,
  Item,
  ItemStatus,
  ListItemsQuery,
  UpdateItemInput,
} from './items.schema';

const CACHE_PREFIX = 'items:';
const CACHE_TTL_SECONDS = 30;

/**
 * The service layer orchestrates: it calls the repo for data, applies the pure
 * rules from items.rules.ts, manages the cache, and enqueues async work.
 * The rules themselves live in their own file precisely so they stay testable
 * without any infrastructure.
 */

// --- Use cases --------------------------------------------------------------

export async function createItem(input: CreateItemInput): Promise<Item> {
  const item = await repo.insertItem(input);

  await invalidate(CACHE_PREFIX);

  // The sync/async seam: the caller does not wait for follow-up work.
  await enqueue('item.created', { itemId: item.id });

  return item;
}

export async function getItem(id: string): Promise<Item> {
  const item = await repo.findItemById(id);
  if (!item) throw NotFound('Item');
  return item;
}

export async function listItemsPaged(
  q: ListItemsQuery,
): Promise<{ items: Item[]; nextCursor: string | null }> {
  const key = `${CACHE_PREFIX}list:${q.status ?? 'all'}:${q.cursor ?? 'start'}:${q.limit}`;

  return cached(key, CACHE_TTL_SECONDS, async () => {
    // Fetch one extra row to know whether another page exists, without COUNT(*).
    const rows = await repo.listItems({ ...q, limit: q.limit + 1 });
    const hasMore = rows.length > q.limit;
    const items = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  });
}

export async function changeStatus(id: string, next: ItemStatus): Promise<Item> {
  const current = await getItem(id);

  if (!canTransition(current.status, next)) {
    throw Conflict(`Cannot move an item from "${current.status}" to "${next}"`, {
      from: current.status,
      to: next,
      allowed: ALLOWED_TRANSITIONS[current.status],
    });
  }

  const updated = await repo.updateItem(id, { status: next });
  if (!updated) throw NotFound('Item');

  await invalidate(CACHE_PREFIX);
  return updated;
}

export async function updateItemDetails(
  id: string,
  input: UpdateItemInput,
): Promise<Item> {
  await getItem(id); // 404 before we attempt the write

  if (input.status) {
    // Route status changes through the rule rather than around it.
    await changeStatus(id, input.status);
  }

  const { status: _status, ...rest } = input;
  const updated = Object.keys(rest).length
    ? await repo.updateItem(id, rest)
    : await repo.findItemById(id);

  if (!updated) throw NotFound('Item');
  await invalidate(CACHE_PREFIX);
  return updated;
}

export async function removeItem(id: string): Promise<void> {
  const deleted = await repo.deleteItem(id);
  if (!deleted) throw NotFound('Item');
  await invalidate(CACHE_PREFIX);
}
