import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router, type Request } from 'express';
import { asyncHandler } from '../../middleware/errorHandler';
import { otpSendRateLimit, otpVerifyRateLimit } from '../../middleware/rateLimit';
import { bookingRefParam } from '../booking/booking.schema';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import type { ForceMode } from '../../lib/gateway';
import * as service from './payment.service';
import { gatewayCallbackSchema, otpVerifySchema } from './payment.schema';

export const paymentRouter = Router();

const FORCE_MODES = ['fail', 'duplicate', 'timeout', 'race', 'success'] as const;

/** Judges drive the gateway's force modes through this passthrough header. */
function forceFrom(header: unknown): ForceMode | undefined {
  if (!env.DEBUG_FORCE_ENABLED || typeof header !== 'string') return undefined;
  return (FORCE_MODES as readonly string[]).includes(header)
    ? (header as ForceMode)
    : undefined;
}

// --- OTP ----------------------------------------------------------------------

paymentRouter.post(
  '/bookings/:ref/otp/send',
  otpSendRateLimit(),
  asyncHandler(async (req, res) => {
    const { ref } = bookingRefParam.parse(req.params);
    const { phone } = await service.requestOtp(ref);
    res.status(202).json({
      booking_ref: ref,
      phone,
      status: 'SENT',
      // The provided gateway prints the code to its own stdout and drops ~10%
      // of them on purpose. There is no channel that delivers it to us.
      hint: 'docker compose logs gateway | grep ' + ref,
    });
  }),
);

paymentRouter.post(
  '/bookings/:ref/otp/verify',
  otpVerifyRateLimit(),
  asyncHandler(async (req, res) => {
    const { ref } = bookingRefParam.parse(req.params);
    const { code } = otpVerifySchema.parse(req.body);
    await service.confirmOtp(ref, code);
    res.json({ booking_ref: ref, otp_verified: true });
  }),
);

// --- Pay ----------------------------------------------------------------------

/**
 * POST /api/v1/bookings/:ref/pay -> 202
 *
 * Returns immediately. The gateway's callback arrives 2-15s later and finishes
 * the booking; the client polls GET /api/v1/bookings/:ref.
 */
paymentRouter.post(
  '/bookings/:ref/pay',
  asyncHandler(async (req, res) => {
    const { ref } = bookingRefParam.parse(req.params);
    const force = forceFrom(req.header('x-debug-force'));
    res.status(202).json(await service.pay(ref, force));
  }),
);

// --- Gateway callback ---------------------------------------------------------

/**
 * Mounted SEPARATELY, ahead of the general rate limiter.
 *
 * Rate limiting the gateway would be self-defeating: a 429 is a non-200, the
 * gateway treats that as failed delivery and retries up to 8 times, so
 * throttling it produces strictly more traffic than accepting it.
 */
export const gatewayCallbackRouter = Router();

/**
 * F6 — the gateway HMAC-SHA256 signs every callback as X-Signature (default
 * secret documented as z2p-2026-secret). Without this, anyone who can reach
 * the endpoint can forge a SUCCEEDED callback and confirm a booking that was
 * never paid for.
 *
 * The HMAC is over the exact bytes on the wire, which is why app.ts's
 * express.json() stashes them onto req.rawBody via its `verify` hook — a
 * re-serialised JS object is not guaranteed to reproduce the original bytes.
 *
 * A missing/invalid signature still gets 200 (never 401): a non-200 tells
 * the gateway delivery failed and it retries up to 8 times, which would turn
 * one forged or misconfigured request into a flood, exactly like a parse
 * failure does below.
 */
function hasValidSignature(req: Request): boolean {
  const signature = req.header('x-signature');
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!signature || !raw) return false;

  const expected = createHmac('sha256', env.GATEWAY_SECRET).update(raw).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Lengths must match before timingSafeEqual will even accept the buffers,
  // and that length check is itself constant-time-irrelevant (it leaks
  // nothing an attacker doesn't already know: the hex-encoded length of a
  // SHA-256 HMAC never varies).
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/v1/gateway/callback
 *
 * ALWAYS 200. A parse error, or a bad signature, here would otherwise turn
 * one bad message into a flood of retries.
 */
gatewayCallbackRouter.post(
  '/callback',
  asyncHandler(async (req, res) => {
    if (!hasValidSignature(req)) {
      logger.warn({ requestId: req.id }, 'Callback signature missing or invalid; ignoring');
      res.status(200).json({ received: true, applied: false });
      return;
    }

    const parsed = gatewayCallbackSchema.safeParse(req.body);

    if (!parsed.success) {
      logger.warn(
        { issues: parsed.error.issues, requestId: req.id },
        'Malformed gateway callback; acknowledging so it is not retried',
      );
      res.status(200).json({ received: true, applied: false });
      return;
    }

    const result = await service.handleCallback(parsed.data);
    res.status(200).json({
      received: true,
      duplicate: result.duplicate,
      action: result.action,
    });
  }),
);
