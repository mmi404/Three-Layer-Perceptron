import { describe, it, expect } from 'vitest';
import { canTransition } from './items.rules';

/**
 * "Unit tests covering core business logic. Depth over count; a handful of
 * meaningful tests beats twenty trivial ones."  — the rulebook, §8
 *
 * So: test the RULE. No database, no HTTP, no mocks. These run in milliseconds
 * and they fail for exactly one reason — someone changed the domain rule.
 *
 * Note what is NOT imported: no db, no redis, no express, no env. That is the
 * whole point of keeping rules in items.rules.ts — and it is a good answer when
 * the panel asks about your testing strategy.
 *
 * Replace this with the rules from the real problem statement. Keep the shape.
 */
describe('item status transitions', () => {
  it('allows a draft to be activated', () => {
    expect(canTransition('draft', 'active')).toBe(true);
  });

  it('allows a draft to be archived without ever going active', () => {
    expect(canTransition('draft', 'archived')).toBe(true);
  });

  it('allows an active item to be archived', () => {
    expect(canTransition('active', 'archived')).toBe(true);
  });

  it('refuses to resurrect an archived item — archived is terminal', () => {
    expect(canTransition('archived', 'active')).toBe(false);
    expect(canTransition('archived', 'draft')).toBe(false);
  });

  it('refuses to send an active item back to draft', () => {
    expect(canTransition('active', 'draft')).toBe(false);
  });

  it('treats a no-op transition as valid so retries are idempotent', () => {
    // Matters on flaky networks: a retried PATCH must not 409.
    expect(canTransition('active', 'active')).toBe(true);
    expect(canTransition('archived', 'archived')).toBe(true);
  });
});
