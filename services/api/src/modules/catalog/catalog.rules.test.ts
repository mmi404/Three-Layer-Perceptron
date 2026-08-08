import { describe, it, expect } from 'vitest';
import { projectSeatStatus } from './catalog.rules';

describe('seat map projection', () => {
  it('reports a booked seat as booked', () => {
    expect(projectSeatStatus('BOOKED', true)).toBe('booked');
  });

  it('reports a live hold as held', () => {
    expect(projectSeatStatus('HELD', true)).toBe('held');
  });

  it('reports an EXPIRED hold as available even before the sweeper runs', () => {
    // This is the property that keeps the map honest when the worker is dead.
    expect(projectSeatStatus('HELD', false)).toBe('available');
  });

  it('hides payment-in-progress behind "held"', () => {
    expect(projectSeatStatus('PENDING_PAYMENT', true)).toBe('held');
  });

  it('reports an available seat as available', () => {
    expect(projectSeatStatus('AVAILABLE', true)).toBe('available');
  });
});
