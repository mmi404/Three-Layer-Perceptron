import { env } from '../config/env';
import { logger } from './logger';

/**
 * Client for the PROVIDED payment/OTP gateway.
 *
 * Its misbehaviour is the specification, not a bug list:
 *   callback delayed 2-15s (always) · 10% FAILED · 8% duplicate callback
 *   · 2% /charge 500 or timeout · 10% OTP never delivered
 *
 * Rules this client follows:
 *  - Every call is time-boxed. An unbounded await on a flaky dependency is how
 *    one slow gateway turns into an exhausted connection pool.
 *  - It is never called from inside a database transaction.
 *  - It is never called from the callback handler.
 *  - Failure is returned, not thrown into the request path: browsing, seat maps
 *    and holds never touch this file at all.
 */

export class GatewayUnavailable extends Error {
  constructor(public readonly cause_: string) {
    super(`Payment gateway unavailable: ${cause_}`);
    this.name = 'GatewayUnavailable';
  }
}

/**
 * The gateway answered and said no, permanently — a 4xx like 404 (unknown
 * payment) or 409 (NOT_REFUNDABLE). Distinct from GatewayUnavailable
 * (transient: 5xx, timeout, network) because retrying can never fix this one.
 */
export class GatewayRejected extends Error {
  constructor(
    public readonly status: number,
    public readonly cause_: string,
  ) {
    super(`Payment gateway rejected the request (${status}): ${cause_}`);
    this.name = 'GatewayRejected';
  }
}

/**
 * CIRCUIT BREAKER.
 *
 * With the gateway container stopped, every call costs ~4 seconds before it
 * fails — Docker's DNS takes that long to give up on a name that no longer
 * resolves. Under load that is far worse than it sounds: each of those calls
 * occupies a request slot for 4s, so a dead dependency quietly consumes the
 * whole API's capacity even though nothing it does can possibly succeed.
 *
 * After CB_THRESHOLD consecutive failures we stop dialling for CB_COOLDOWN_MS
 * and fail instantly instead. Exactly ONE request is let through after the
 * cooldown to test the water (half-open); a success closes the circuit, a
 * failure restarts the cooldown.
 *
 * The user-visible effect: a 4s hang becomes an immediate, honest 503.
 */
const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 10_000;

const breaker = { failures: 0, openedAt: 0, probing: false };

/**
 * `probing` is the fix for the old bug: the cooldown elapsing does not by
 * itself mean the circuit is closed, it means ONE caller may try. The first
 * caller past the cooldown claims the probe slot; everyone else concurrent
 * with it still sees the circuit as open, instead of every waiting caller
 * piling a ~4s probe onto a gateway that may still be dead.
 */
function circuitOpen(): boolean {
  if (breaker.failures < CB_THRESHOLD) return false;
  if (Date.now() - breaker.openedAt < CB_COOLDOWN_MS) return true;
  if (breaker.probing) return true;
  breaker.probing = true;
  return false;
}

function recordSuccess(): void {
  if (breaker.failures > 0) logger.info('Gateway recovered, circuit closed');
  breaker.failures = 0;
  breaker.probing = false;
}

function recordFailure(): void {
  breaker.probing = false;
  breaker.failures++;
  if (breaker.failures >= CB_THRESHOLD) {
    // (Re)start the cooldown on every failure once open — including a failed
    // probe — so the next probe is a full CB_COOLDOWN_MS away, not immediate.
    breaker.openedAt = Date.now();
    if (breaker.failures === CB_THRESHOLD) {
      logger.warn(
        { cooldownMs: CB_COOLDOWN_MS },
        'Gateway circuit opened; failing fast instead of waiting on a dead dependency',
      );
    }
  }
}

/**
 * Pure read for diagnostics and metrics. Deliberately does NOT call
 * circuitOpen(): that function has the side effect of claiming the one
 * half-open probe slot, so a status read used to be able to consume the
 * probe that an actual request should have gotten.
 */
export function circuitState(): 'closed' | 'open' | 'half-open' {
  if (breaker.failures < CB_THRESHOLD) return 'closed';
  if (Date.now() - breaker.openedAt >= CB_COOLDOWN_MS) return 'half-open';
  return 'open';
}

/** Force headers let judges test every team under identical conditions. */
export type ForceMode = 'fail' | 'duplicate' | 'timeout' | 'race' | 'success';

function headers(force?: ForceMode, idempotencyKey?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.GATEWAY_MODE === 'deterministic') h['X-Mock-Mode'] = 'deterministic';
  if (force && env.DEBUG_FORCE_ENABLED) h['X-Mock-Force'] = force;
  if (idempotencyKey) h['Idempotency-Key'] = idempotencyKey;
  return h;
}

async function call<T>(
  path: string,
  body: unknown,
  force?: ForceMode,
  idempotencyKey?: string,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string }> {
  if (circuitOpen()) {
    return { ok: false, status: 0, error: 'circuit open (gateway is down)' };
  }
  try {
    const res = await fetch(`${env.GATEWAY_URL}${path}`, {
      method: 'POST',
      headers: headers(force, idempotencyKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.GATEWAY_TIMEOUT_MS),
    });
    const data = (await res.json().catch(() => null)) as T;

    // A 4xx is the gateway working correctly and rejecting us; only transport
    // failures and 5xx count against the breaker.
    if (res.status >= 500) recordFailure();
    else recordSuccess();

    if (!res.ok) {
      return { ok: false, status: res.status, error: JSON.stringify(data ?? res.statusText) };
    }
    return { ok: true, status: res.status, data };
  } catch (err) {
    recordFailure();
    const reason =
      err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : String(err);
    return { ok: false, status: 0, error: reason };
  }
}

export type ChargeResponse = { payment_id: string; status: string };

/**
 * POST /charge -> 202 { payment_id, status: "PENDING" }
 *
 * Retries only on 5xx or timeout, always with the SAME booking_ref AND the
 * same Idempotency-Key (F5a). The key matters specifically because a timeout
 * tells us nothing about what happened at the gateway's end — it may have
 * created the charge and simply lost the response. Without the header, that
 * retry becomes a genuine SECOND charge; with it, the gateway recognises the
 * replay and returns the original charge instead of creating a new one.
 * 4xx is our mistake and is never retried.
 */
export async function charge(
  input: { amount: number; currency: string; booking_ref: string; callback_url: string },
  force?: ForceMode,
): Promise<ChargeResponse> {
  const MAX_ATTEMPTS = 3;
  let last = 'unknown';
  // Stable across all retries of this one charge attempt, unique per booking.
  const idempotencyKey = `charge:${input.booking_ref}`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await call<ChargeResponse>('/charge', input, force, idempotencyKey);

    if (res.ok) {
      logger.info(
        { bookingRef: input.booking_ref, paymentId: res.data.payment_id, attempt },
        'Charge accepted by gateway',
      );
      return res.data;
    }

    last = res.error;
    const retryable = res.status === 0 || res.status >= 500;
    if (!retryable) break;

    logger.warn(
      { bookingRef: input.booking_ref, attempt, status: res.status },
      'Charge attempt failed, retrying',
    );
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }

  throw new GatewayUnavailable(last);
}

/** Throws GatewayRejected for a permanent 4xx (unknown payment / not refundable),
 *  GatewayUnavailable for anything transient (5xx, timeout, circuit open). */
export async function refund(paymentId: string): Promise<{ status: string }> {
  const res = await call<{ status: string }>('/refund', { payment_id: paymentId });
  if (!res.ok) {
    if (res.status >= 400 && res.status < 500) throw new GatewayRejected(res.status, res.error);
    throw new GatewayUnavailable(res.error);
  }
  return res.data;
}

export async function sendOtp(phone: string, ref: string): Promise<void> {
  const res = await call('/otp/send', { phone, ref });
  if (!res.ok) throw new GatewayUnavailable(res.error);
}

/** Returns false for a wrong code (gateway answers 400), throws if it is down. */
export async function verifyOtp(ref: string, code: string): Promise<boolean> {
  const res = await call<{ verified: boolean }>('/otp/verify', { ref, code });
  if (res.ok) return true;
  if (res.status === 400) return false;      // wrong code — an answer, not a fault
  throw new GatewayUnavailable(res.error);
}

/** Used only by diagnostics. Never called from /health. */
export async function gatewayHealthy(): Promise<boolean> {
  try {
    const res = await fetch(`${env.GATEWAY_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
