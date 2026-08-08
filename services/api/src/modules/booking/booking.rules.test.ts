import { describe, it, expect } from 'vitest';
import {
  canTransition,
  isHoldPayable,
  isSeatClaimable,
  totalCents,
} from './booking.rules';

/**
 * Pure rules. No database, no HTTP, no mocks, no sleeping.
 * Every function takes the time it should judge against, which is why expiry
 * can be tested exhaustively in microseconds.
 */

const T0 = new Date('2026-08-08T12:00:00Z');
const before = (s: number) => new Date(T0.getTime() - s * 1000);
const after = (s: number) => new Date(T0.getTime() + s * 1000);

describe('booking state machine', () => {
  it('allows a hold to move to payment', () => {
    expect(canTransition('HELD', 'PENDING_PAYMENT')).toBe(true);
  });

  it('allows a payment to confirm or fail', () => {
    expect(canTransition('PENDING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'FAILED')).toBe(true);
  });

  it('never un-confirms a confirmed booking', () => {
    // A late FAILED callback after a SUCCEEDED one must not revoke a ticket.
    expect(canTransition('CONFIRMED', 'FAILED')).toBe(false);
    expect(canTransition('CONFIRMED', 'EXPIRED')).toBe(false);
  });

  it('never resurrects an expired or failed booking', () => {
    expect(canTransition('EXPIRED', 'HELD')).toBe(false);
    expect(canTransition('FAILED', 'CONFIRMED')).toBe(false);
  });

  it('treats a repeated transition as valid so duplicate callbacks are safe', () => {
    expect(canTransition('CONFIRMED', 'CONFIRMED')).toBe(true);
    expect(canTransition('FAILED', 'FAILED')).toBe(true);
  });

  it('cannot skip payment and jump straight to confirmed', () => {
    expect(canTransition('HELD', 'CONFIRMED')).toBe(false);
  });
});

describe('seat claimability (lazy expiry)', () => {
  it('an available seat is claimable', () => {
    expect(isSeatClaimable({ status: 'AVAILABLE', hold_expires_at: null }, T0)).toBe(true);
  });

  it('a live hold is NOT claimable', () => {
    expect(isSeatClaimable({ status: 'HELD', hold_expires_at: after(30) }, T0)).toBe(false);
  });

  it('an expired hold IS claimable, without waiting for the sweeper', () => {
    // The property that makes correctness independent of the worker.
    expect(isSeatClaimable({ status: 'HELD', hold_expires_at: before(1) }, T0)).toBe(true);
  });

  it('a seat mid-payment is never claimable, expired or not', () => {
    expect(isSeatClaimable({ status: 'PENDING_PAYMENT', hold_expires_at: null }, T0)).toBe(false);
    expect(isSeatClaimable({ status: 'PENDING_PAYMENT', hold_expires_at: before(99) }, T0)).toBe(false);
  });

  it('a booked seat is never claimable', () => {
    expect(isSeatClaimable({ status: 'BOOKED', hold_expires_at: null }, T0)).toBe(false);
  });
});

describe('hold payability', () => {
  const base = { status: 'HELD' as const, expires_at: after(60), otp_verified: true };

  it('accepts a verified hold with time left', () => {
    expect(isHoldPayable(base, T0)).toEqual({ ok: true });
  });

  it('rejects an unverified phone', () => {
    const r = isHoldPayable({ ...base, otp_verified: false }, T0);
    expect(r.ok).toBe(false);
  });

  it('rejects a hold that has run out of time', () => {
    const r = isHoldPayable({ ...base, expires_at: before(1) }, T0);
    expect(r.ok).toBe(false);
  });

  it('rejects paying twice for the same booking', () => {
    const r = isHoldPayable({ ...base, status: 'PENDING_PAYMENT' }, T0);
    expect(r.ok).toBe(false);
  });

  it('treats the exact expiry instant as expired, not as a grace period', () => {
    const r = isHoldPayable({ ...base, expires_at: T0 }, T0);
    expect(r.ok).toBe(false);
  });
});

describe('pricing', () => {
  it('sums seat prices', () => {
    expect(totalCents([{ price_cents: 45000 }, { price_cents: 56250 }])).toBe(101250);
  });

  it('an empty selection costs nothing', () => {
    expect(totalCents([])).toBe(0);
  });
});
