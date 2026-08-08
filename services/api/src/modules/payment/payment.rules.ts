export type PaymentStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export type CallbackStatus = 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

/**
 * What a callback should actually DO, given what we already believe.
 *
 * This pure function is the entire idempotency argument, and it is the thing
 * to point at when the panel asks about duplicate callbacks. The gateway sends
 * ~8% of callbacks twice, retries anything we do not answer 200 (up to 8
 * times), and can deliver out of order.
 *
 *   CONFIRM      — first success: confirm the booking, mark seats BOOKED
 *   FAIL         — first failure: release the seats
 *   IGNORE       — we have already reached this conclusion, or the callback
 *                  is stale and would undo a decision we are not allowed to
 *                  reverse
 *   REFUND       — money arrived for a booking we already gave up on. We
 *                  must not resurrect the booking (someone else may hold
 *                  those seats now), so the only honest response is to give
 *                  the money back.
 *   REFUND_DONE  — the gateway confirming a refund WE issued. Distinct from
 *                  CONFIRM: there is no booking to confirm, only a payment
 *                  row to close out.
 */
export type CallbackAction = 'CONFIRM' | 'FAIL' | 'IGNORE' | 'REFUND' | 'REFUND_DONE';

export function decideCallback(
  current: PaymentStatus,
  incoming: CallbackStatus,
): CallbackAction {
  switch (incoming) {
    case 'SUCCEEDED':
      // Normal path: money confirmed while we were waiting.
      if (current === 'INITIATED' || current === 'PENDING') return 'CONFIRM';
      // Duplicate of a success we already applied.
      if (current === 'SUCCEEDED') return 'IGNORE';
      // We timed the payment out and released the seats, then the money landed.
      // Confirming now could double-sell a seat someone else already holds.
      if (current === 'FAILED') return 'REFUND';
      return 'IGNORE';

    case 'FAILED':
      if (current === 'INITIATED' || current === 'PENDING') return 'FAIL';
      // A late FAILED after a SUCCEEDED must never revoke a confirmed ticket.
      if (current === 'SUCCEEDED') return 'IGNORE';
      return 'IGNORE';

    case 'REFUNDED':
      // The gateway confirming a refund we asked for. Record it; there is
      // nothing else to undo — the seats were released when we gave up.
      if (current === 'REFUND_PENDING') return 'REFUND_DONE';
      return 'IGNORE';

    default:
      return 'IGNORE';
  }
}

/**
 * A payment is considered abandoned once it has been in flight longer than the
 * timeout. The gateway promises callbacks within 15s; the timeout is far
 * larger, so this only fires on genuine loss, not on ordinary slowness.
 */
export function isPaymentTimedOut(
  payment: { status: PaymentStatus; created_at: Date | string },
  timeoutSeconds: number,
  now: Date,
): boolean {
  if (payment.status !== 'INITIATED' && payment.status !== 'PENDING') return false;
  const age = (now.getTime() - new Date(payment.created_at).getTime()) / 1000;
  return age > timeoutSeconds;
}
