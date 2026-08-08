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
 * CIRCUIT BREAKER.
 *
 * With the gateway container stopped, every call costs ~4 seconds before it
 * fails — Docker's DNS takes that long to give up on a name that no longer
 * resolves. Under load that is far worse than it sounds: each of those calls
 * occupies a request slot for 4s, so a dead dependency quietly consumes the
 * whole API's capacity even though nothing it does can possibly succeed.
 *
 * After CB_THRESHOLD consecutive failures we stop dialling for CB_COOLDOWN_MS
 * and fail instantly instead. One probe is allowed through after the cooldown
 * (half-open); a success closes the circuit again.
 *
 * The user-visible effect: a 4s hang becomes an immediate, honest 503.
 */
const CB_THRESHOLD = 3;
const CB_COOLDOWN_MS = 10_000;

const breaker = { failures: 0, openedAt: 0 };

function circuitOpen(): boolean {
  if (breaker.failures < CB_THRESHOLD) return false;
  if (Date.now() - breaker.openedAt >= CB_COOLDOWN_MS) {
    // Half-open: let exactly one request through to test the water.
    breaker.failures = CB_THRESHOLD - 1;
    return false;
  }
  return true;
}

function recordSuccess(): void {
  if (breaker.failures > 0) {
    logger.info('Gateway recovered, circuit closed');
    breaker.failures = 0;
  }
}

function recordFailure(): void {
  breaker.failures++;
  if (breaker.failures === CB_THRESHOLD) {
    breaker.openedAt = Date.now();
    logger.warn(
      { cooldownMs: CB_COOLDOWN_MS },
      'Gateway circuit opened; failing fast instead of waiting on a dead dependency',
    );
  }
}

/** Exposed for /ready-style diagnostics and tests. */
export function circuitState(): 'closed' | 'open' {
  return circuitOpen() ? 'open' : 'closed';
}

/** Force headers let judges test every team under identical conditions. */
export type ForceMode = 'fail' | 'duplicate' | 'timeout' | 'race' | 'success';

function headers(force?: ForceMode): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.GATEWAY_MODE === 'deterministic') h['X-Mock-Mode'] = 'deterministic';
  if (force && env.DEBUG_FORCE_ENABLED) h['X-Mock-Force'] = force;
  return h;
}

async function call<T>(
  path: string,
  body: unknown,
  force?: ForceMode,
): Promise<{ ok: true; status: number; data: T } | { ok: false; status: number; error: string }> {
  if (circuitOpen()) {
    return { ok: false, status: 0, error: 'circuit open (gateway is down)' };
  }
  try {
    const res = await fetch(`${env.GATEWAY_URL}${path}`, {
      method: 'POST',
      headers: headers(force),
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
 * Retries only on 5xx or timeout, and always with the SAME booking_ref, so a
 * retry the gateway did receive cannot become a second charge. 4xx is our
 * mistake and is never retried.
 */
export async function charge(
  input: { amount: number; currency: string; booking_ref: string; callback_url: string },
  force?: ForceMode,
): Promise<ChargeResponse> {
  const MAX_ATTEMPTS = 3;
  let last = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await call<ChargeResponse>('/charge', input, force);

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

export async function refund(paymentId: string): Promise<{ status: string }> {
  const res = await call<{ status: string }>('/refund', { payment_id: paymentId });
  if (!res.ok) throw new GatewayUnavailable(res.error);
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
