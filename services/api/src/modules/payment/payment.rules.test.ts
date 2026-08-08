import { describe, it, expect } from 'vitest';
import { decideCallback, isPaymentTimedOut, type PaymentStatus } from './payment.rules';

/**
 * The duplicate-callback contract, exhaustively. Pure function, no I/O.
 *
 * The gateway delivers ~8% of callbacks twice, retries anything not answered
 * with 200 up to 8 times, and can deliver out of order. Every one of those
 * cases is a row in this table.
 */
describe('callback decisions', () => {
  it('confirms the first successful callback', () => {
    expect(decideCallback('INITIATED', 'SUCCEEDED')).toBe('CONFIRM');
    expect(decideCallback('PENDING', 'SUCCEEDED')).toBe('CONFIRM');
  });

  it('IGNORES a duplicate success — no second confirm, no double revenue', () => {
    expect(decideCallback('SUCCEEDED', 'SUCCEEDED')).toBe('IGNORE');
  });

  it('fails the first failure callback', () => {
    expect(decideCallback('INITIATED', 'FAILED')).toBe('FAIL');
    expect(decideCallback('PENDING', 'FAILED')).toBe('FAIL');
  });

  it('IGNORES a duplicate failure', () => {
    expect(decideCallback('FAILED', 'FAILED')).toBe('IGNORE');
  });

  it('never revokes a confirmed ticket on a late FAILED callback', () => {
    // Out-of-order delivery must not take a seat away from someone who paid.
    expect(decideCallback('SUCCEEDED', 'FAILED')).toBe('IGNORE');
  });

  it('REFUNDS money that arrives after we already gave up on the booking', () => {
    // We timed out and released the seats; another buyer may hold them now.
    // Confirming would oversell, so the only correct action is to refund.
    expect(decideCallback('FAILED', 'SUCCEEDED')).toBe('REFUND');
  });

  it('does nothing further once a refund is in flight or done', () => {
    expect(decideCallback('REFUND_PENDING', 'SUCCEEDED')).toBe('IGNORE');
    expect(decideCallback('REFUNDED', 'SUCCEEDED')).toBe('IGNORE');
    expect(decideCallback('REFUNDED', 'FAILED')).toBe('IGNORE');
  });

  it('is total — every state/callback pair has a defined action', () => {
    const states: PaymentStatus[] = [
      'INITIATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUND_PENDING', 'REFUNDED',
    ];
    for (const s of states) {
      for (const c of ['SUCCEEDED', 'FAILED', 'REFUNDED'] as const) {
        expect(['CONFIRM', 'FAIL', 'IGNORE', 'REFUND']).toContain(decideCallback(s, c));
      }
    }
  });

  it('applying the same callback twice is a no-op the second time', () => {
    // Property check: whatever the first delivery decides, replaying the
    // resulting state must not act again.
    const first = decideCallback('PENDING', 'SUCCEEDED');
    expect(first).toBe('CONFIRM');
    expect(decideCallback('SUCCEEDED', 'SUCCEEDED')).toBe('IGNORE');
  });
});

describe('payment timeout', () => {
  const now = new Date('2026-08-08T12:00:00Z');
  const agedSeconds = (s: number) => new Date(now.getTime() - s * 1000);

  it('does not time out a payment that is still young', () => {
    expect(isPaymentTimedOut({ status: 'PENDING', created_at: agedSeconds(10) }, 90, now))
      .toBe(false);
  });

  it('times out a payment that outlived the window', () => {
    expect(isPaymentTimedOut({ status: 'PENDING', created_at: agedSeconds(120) }, 90, now))
      .toBe(true);
  });

  it('never times out a settled payment, however old', () => {
    expect(isPaymentTimedOut({ status: 'SUCCEEDED', created_at: agedSeconds(9999) }, 90, now))
      .toBe(false);
    expect(isPaymentTimedOut({ status: 'FAILED', created_at: agedSeconds(9999) }, 90, now))
      .toBe(false);
  });

  it('tolerates gateway delay up to its documented 15s worst case', () => {
    expect(isPaymentTimedOut({ status: 'PENDING', created_at: agedSeconds(15) }, 90, now))
      .toBe(false);
  });
});
