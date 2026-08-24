import { z } from "zod";

import { PaymentMethod } from "@/lib/payments/payment";

/**
 * Request validation for the payment API.
 *
 * Note what is NOT here: amount, currency, price, machine id, payment status.
 * The server owns all of those. A body that tries to supply one is rejected by
 * `strictObject` rather than silently ignored, so a mistake — or an attempt —
 * in the client is loud instead of dangerous.
 *
 * The browser is allowed to say only: which machine QR it scanned, which
 * product it wants, which order it is paying, and how it wants to pay.
 */

/** Opaque machine token as carried by the QR. Never a database id. */
const MachineTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, "machineToken is malformed");

const ProductIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_]{3,64}$/, "productId is malformed");

const OrderIdSchema = z
  .string()
  .trim()
  .regex(/^ord_[0-9a-f-]{36}$/, "orderId is malformed");

export const PaymentMethodSchema = z.enum([
  PaymentMethod.CARD,
  PaymentMethod.APPLE_PAY,
  PaymentMethod.GOOGLE_PAY,
]);

/** POST /api/v1/orders */
export const CreateOrderRequestSchema = z.strictObject({
  machineToken: MachineTokenSchema,
  productId: ProductIdSchema,
});

export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

/**
 * POST /api/v1/payments/afs/checkout
 *
 * `machineToken` is the QR token, not a machine id: the server resolves it and
 * checks the order actually belongs to that machine.
 */
export const CreateCheckoutRequestSchema = z.strictObject({
  machineToken: MachineTokenSchema,
  orderId: OrderIdSchema,
  method: PaymentMethodSchema,
});

export type CreateCheckoutRequest = z.infer<typeof CreateCheckoutRequestSchema>;

/**
 * The standalone /payment-test POC checkout, which has no machine or order.
 * Kept separate so the QR flow's stricter rules are not weakened for it.
 */
export const CreateTestCheckoutRequestSchema = z.strictObject({
  machineId: z
    .string()
    .trim()
    .regex(/^[A-Z0-9-]{3,32}$/, "machineId must be 3-32 chars of A-Z, 0-9 or '-'")
    .optional(),
});

/** `resourcePath` as AFS appends it to the shopperResultUrl. */
export const PaymentStatusQuerySchema = z.object({
  resourcePath: z
    .string()
    .trim()
    .min(1, "resourcePath is required")
    .regex(
      /^\/v1\/checkouts\/[A-Za-z0-9._-]+\/payment$/,
      "resourcePath must look like /v1/checkouts/{checkoutId}/payment",
    ),
});

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}
