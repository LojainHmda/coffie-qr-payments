import { z } from "zod";

import { PaymentMethod } from "@/lib/payments/payment";

/**
 * Request validation for the order and payment APIs.
 *
 * Note what is NOT here: amount, currency, price, machine id, payment status.
 * The server owns all of those. A body that tries to supply one is rejected by
 * `strictObject` rather than silently ignored, so a mistake — or an attempt —
 * in the client is loud instead of dangerous.
 *
 * A machine may say only: which products, how many. It does not name itself in
 * the body — its API key does that, and a body cannot prove identity.
 *
 * A customer's phone may say only: which pay token it scanned, and how it wants
 * to pay. It never names a machine, a product or a price.
 */

/** Opaque per-order token as carried by the machine's QR. */
const PayTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{22,64}$/, "payToken is malformed");

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

/**
 * POST /api/v1/machine/orders — the machine reporting what the customer chose.
 *
 * The bounds are the vending machine's own physical limits made explicit: a
 * basket is small, and a quantity is a number of cups, so anything outside that
 * is a bug or an attempt to make the server total something absurd.
 */
export const MachineOrderLineSchema = z.strictObject({
  productId: ProductIdSchema,
  quantity: z.number().int().min(1).max(20),
});

export const CreateMachineOrderRequestSchema = z.strictObject({
  lines: z.array(MachineOrderLineSchema).min(1).max(10),
});

export type CreateMachineOrderRequest = z.infer<typeof CreateMachineOrderRequestSchema>;

/** GET /api/v1/machine/orders/{orderId} */
export const MachineOrderIdSchema = OrderIdSchema;

/**
 * POST /api/v1/payments/checkout
 *
 * `payToken` is the token from the machine's QR. It resolves to exactly one
 * already-priced order, which is why nothing else about the purchase appears
 * in this body.
 */
export const CreateCheckoutRequestSchema = z.strictObject({
  payToken: PayTokenSchema,
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
