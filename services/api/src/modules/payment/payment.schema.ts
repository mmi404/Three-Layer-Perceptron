import { z } from 'zod';

export const otpSendSchema = z.object({}).passthrough().optional();

export const otpVerifySchema = z.object({
  code: z.string().trim().regex(/^[0-9]{4,8}$/, 'code must be 4-8 digits'),
});

/**
 * Callback body from the gateway.
 *
 * Deliberately lenient: `.passthrough()` keeps unknown fields, and only
 * event_id is truly required. A callback we cannot parse still gets a 200 —
 * a non-200 makes the gateway retry up to 8 times, which turns one malformed
 * message into a small flood.
 */
export const gatewayCallbackSchema = z
  .object({
    event_id: z.string().min(1),
    payment_id: z.string().optional(),
    booking_ref: z.string().optional(),
    status: z.enum(['SUCCEEDED', 'FAILED', 'REFUNDED']).optional(),
    amount: z.number().optional(),
  })
  .passthrough();

export type GatewayCallback = z.infer<typeof gatewayCallbackSchema>;
