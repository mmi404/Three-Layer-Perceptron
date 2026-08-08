import { env } from '../../config/env';
import { AppError, Conflict, NotFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import * as gateway from '../../lib/gateway';
import { GatewayRejected, GatewayUnavailable, type ForceMode } from '../../lib/gateway';
import { invalidateSeatMap } from '../catalog/catalog.service';
import { callbacksTotal } from '../metrics/metrics.routes';
import * as repo from './payment.repo';
import type { GatewayCallback } from './payment.schema';

const GATEWAY_DOWN = (detail: string) =>
  new AppError(503, 'GATEWAY_UNAVAILABLE', 'Payment provider is unavailable, try again shortly', {
    detail,
  });

// --- OTP ----------------------------------------------------------------------

export async function requestOtp(ref: string): Promise<{ phone: string; code?: string }> {
  const booking = await repo.findBookingForOtp(ref);
  if (!booking) throw NotFound('Booking');
  if (booking.status !== 'HELD') {
    throw Conflict(`Booking is ${booking.status}; OTP only applies to a live hold`);
  }

  let gatewayRes: any;
  try {
    gatewayRes = await gateway.sendOtp(booking.phone, ref);
  } catch (err) {
    if (err instanceof GatewayUnavailable) throw GATEWAY_DOWN(err.cause_);
    throw err;
  }

  // The gateway drops ~10% of OTPs on purpose. Resending is allowed and
  // rate-limited; we never pretend delivery is guaranteed.
  logger.info({ bookingRef: ref }, 'OTP requested');
  return { 
    phone: maskPhone(booking.phone),
    code: gatewayRes?.code || gatewayRes?.otp
  };
}

export async function confirmOtp(ref: string, code: string): Promise<void> {
  const booking = await repo.findBookingForOtp(ref);
  if (!booking) throw NotFound('Booking');
  if (booking.otp_verified) return;   // idempotent

  let verified: boolean;
  try {
    verified = await gateway.verifyOtp(ref, code);
  } catch (err) {
    if (err instanceof GatewayUnavailable) throw GATEWAY_DOWN(err.cause_);
    throw err;
  }

  if (!verified) throw new AppError(400, 'OTP_INVALID', 'That code is not valid');
  await repo.markOtpVerified(ref);
  logger.info({ bookingRef: ref }, 'OTP verified');
}

function maskPhone(p: string): string {
  return p.length <= 4 ? '****' : `${p.slice(0, 3)}****${p.slice(-2)}`;
}

// --- Pay ----------------------------------------------------------------------

/**
 * Start a payment and return immediately.
 *
 * The handler must NOT wait for the gateway: callbacks take 2-15 seconds by
 * specification, and blocking a request thread on that would exhaust the pool
 * during a premiere rush. We commit our intent, fire the charge, and answer
 * 202. The callback finishes the job.
 */
export async function pay(
  ref: string,
  force?: ForceMode,
): Promise<{ booking_ref: string; payment_status: string; poll: string }> {
  const started = await repo.startPayment(ref);

  try {
    const charged = await gateway.charge(
      {
        amount: started.amountCents,
        currency: 'BDT',
        booking_ref: started.bookingRef,
        callback_url: env.CALLBACK_URL,
      },
      force,
    );
    await repo.attachGatewayPaymentId(started.paymentId, charged.payment_id);
  } catch (err) {
    if (err instanceof GatewayUnavailable) {
      // Could not hand the charge over. Release the seats now rather than
      // pinning them until the timeout sweeper notices.
      const { showtimeId } = await repo.abandonPayment(started.paymentId);
      if (showtimeId) void invalidateSeatMap(showtimeId);
      logger.error({ bookingRef: ref, cause: err.cause_ }, 'Charge could not be placed');
      throw GATEWAY_DOWN(err.cause_);
    }
    throw err;
  }

  void invalidateSeatMap(started.showtimeId);

  return {
    booking_ref: started.bookingRef,
    payment_status: 'PENDING',
    poll: `/api/v1/bookings/${started.bookingRef}`,
  };
}

// --- Callback -----------------------------------------------------------------

/**
 * Handle a gateway callback.
 *
 * Contract we hold ourselves to:
 *   1. ALWAYS answer 200, including for duplicates and garbage. A non-200
 *      tells the gateway delivery failed and it retries up to 8 times.
 *   2. A duplicate must not confirm twice, charge twice or double-count.
 *   3. No outbound network calls here — a refund is queued, never awaited.
 */
export async function handleCallback(
  body: GatewayCallback,
): Promise<{ duplicate: boolean; action: string }> {
  // F4: recording the event_id and applying its effect happen inside ONE
  // transaction (see payment.repo.recordAndApplyCallback). Previously these
  // were two separate operations, and a failure between them could mark an
  // event permanently "seen" with nothing applied.
  const result = await repo.recordAndApplyCallback(
    body.event_id,
    body.booking_ref ?? null,
    body.status ?? null,
    body.payment_id ?? null,
    body,
  );

  if (result.duplicate) {
    callbacksTotal.inc({ dedup: 'hit' });
    logger.info({ eventId: body.event_id }, 'Duplicate callback suppressed');
    return { duplicate: true, action: 'IGNORE' };
  }
  callbacksTotal.inc({ dedup: 'miss' });

  if (result.showtimeId && result.action !== 'IGNORE') {
    void invalidateSeatMap(result.showtimeId);
  }

  logger.info(
    { eventId: body.event_id, bookingRef: body.booking_ref, action: result.action },
    'Callback applied',
  );
  return { duplicate: false, action: result.action };
}

// --- Worker duties ------------------------------------------------------------

/** Bounded batches (F10), same reasoning as booking.service.sweepExpired. */
const MAX_SWEEP_BATCHES = 20;

export async function sweepPayments(): Promise<number> {
  let totalFailed = 0;
  const touched = new Set<string>();

  for (let i = 0; i < MAX_SWEEP_BATCHES; i++) {
    const { failed, showtimeIds } = await repo.sweepTimedOutPayments(env.PAYMENT_TIMEOUT_SECONDS);
    showtimeIds.forEach((id) => touched.add(id));
    totalFailed += failed;
    if (failed < repo.SWEEP_BATCH_SIZE) break;
  }

  if (totalFailed > 0) {
    await Promise.all([...touched].map(invalidateSeatMap));
    logger.warn({ failed: totalFailed }, 'Failed payments that never received a callback');
  }
  return totalFailed;
}

/**
 * Money that landed for a booking we had already given up on.
 *
 * A refund can fail PERMANENTLY (gateway 404 unknown payment, 409
 * NOT_REFUNDABLE) as well as transiently (5xx, timeout). Previously every
 * failure looked the same and the reconciler retried a permanent failure
 * forever, every 10s, indefinitely. Now: a permanent rejection or exhausting
 * MAX_REFUND_ATTEMPTS transient ones moves the payment to REFUND_FAILED, a
 * terminal state that stops the reconciler and is worth someone looking at.
 */
export async function processRefunds(): Promise<number> {
  const pending = await repo.listRefundsPending();
  let done = 0;
  for (const p of pending) {
    try {
      await gateway.refund(p.gateway_payment_id!);
      await repo.markRefunded(p.id);
      logger.info({ bookingRef: p.booking_ref }, 'Refund issued');
      done++;
    } catch (err) {
      if (err instanceof GatewayRejected) {
        await repo.markRefundFailed(p.id, true);
        logger.error(
          { status: err.status, bookingRef: p.booking_ref },
          'Refund permanently rejected by gateway; giving up',
        );
      } else if (p.refund_attempts + 1 >= repo.MAX_REFUND_ATTEMPTS) {
        await repo.markRefundFailed(p.id, true);
        logger.error(
          { attempts: p.refund_attempts + 1, bookingRef: p.booking_ref },
          'Refund exhausted retry attempts; giving up',
        );
      } else {
        await repo.markRefundFailed(p.id, false);
        logger.warn(
          { err, attempts: p.refund_attempts + 1, bookingRef: p.booking_ref },
          'Refund failed, will retry',
        );
      }
    }
  }
  return done;
}
