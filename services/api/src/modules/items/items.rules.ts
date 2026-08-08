import type { ItemStatus } from './items.schema';

/**
 * PURE BUSINESS RULES — zero imports from lib/, no database, no HTTP, no env.
 *
 * This separation is deliberate and it is worth explaining to the panel:
 * because these functions touch no infrastructure, their unit tests need no
 * container, no mocks and no fixtures. They run in milliseconds and they fail
 * for exactly one reason — someone changed a domain rule.
 *
 * Rule of thumb: if a function needs a mock to test, it probably has a
 * dependency that belongs in the service layer instead.
 *
 * Put the real problem statement's rules HERE.
 */

export const ALLOWED_TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  draft: ['active', 'archived'],
  active: ['archived'],
  archived: [], // terminal state — an archived item cannot come back
};

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  // A no-op transition is valid so that a retried request is idempotent.
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}
