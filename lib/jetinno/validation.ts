import { z } from "zod";

import { JetinnoFinishState } from "./protocol";

/**
 * Inbound validation for the four interfaces Jetinno calls on us.
 *
 * Deliberately NOT `strictObject`, which is the opposite of the rule used
 * everywhere else in this app. §2.4 requires it:
 *
 *   "The interface may add fields, and the added extended fields must be
 *    supported when verifying the signature"
 *
 * A future firmware may add a field, sign it, and expect us to cope. Rejecting
 * unknown keys would fail those messages, and — worse — silently stripping them
 * before signature verification would break every signature that included one.
 * Unknown fields are therefore preserved, carried into the signature base, and
 * ignored by the business logic.
 *
 * Field lengths in the specification's tables are misaligned across columns in
 * the published PDF, so the bounds here are generous where the document is
 * unreadable and strict only where the prose is unambiguous.
 */

/** §2.2 — yyyyMMddHHmmss. */
const TimestampSchema = z
  .string()
  .trim()
  .regex(/^\d{14}$/, "time must be yyyyMMddHHmmss");

const SignSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-fA-F]{32}$/, "sign must be a 32-character MD5 digest");

/** "Merchant order number, globally unique (enter numbers or letters only)". */
const OrderNoSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9]+$/, "orderNo must contain only letters and digits");

const DeviceNoSchema = z.string().trim().min(1).max(64);

/** "Order amount, in cents" — integer minor units, on the wire as a string. */
const AmountSchema = z.union([
  z.string().trim().regex(/^\d{1,12}$/, "amount must be a whole number of cents"),
  z.number().int().nonnegative(),
]);

/**
 * §3.3.1 — we POST the payment result to this address, so it is an outbound
 * request to a host the message itself names. It must be an absolute http(s)
 * URL and nothing else: a `file:` or `gopher:` scheme here would turn our
 * callback into a request we never intended to make.
 */
const NotifyUrlSchema = z
  .string()
  .trim()
  .max(256)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }, "notifyUrl must be an absolute http(s) URL");

const OptionalText = (max: number) => z.string().trim().max(max).optional();

/** The outer envelope, common to every inbound interface (§2.2). */
export const EnvelopeSchema = z.looseObject({
  username: z.string().trim().min(1).max(64),
  time: TimestampSchema,
  sign: SignSchema,
  data: z.looseObject({}),
});

export type JetinnoInboundEnvelope = z.infer<typeof EnvelopeSchema>;

/** §3.1.2 — Get QR Code. */
export const GetQrCodeDataSchema = z.looseObject({
  deviceNo: DeviceNoSchema,
  merchantNo: OptionalText(64),
  productId: z.string().trim().min(1).max(64),
  productName: z.string().trim().min(1).max(128),
  orderNo: OrderNoSchema,
  orderAmount: AmountSchema,
  notifyUrl: NotifyUrlSchema.optional(),
  payType: OptionalText(16),
  attach: OptionalText(256),
});

export type GetQrCodeData = z.infer<typeof GetQrCodeDataSchema>;

/** §3.2.2 — Scanned (reverse-scan) payment: the machine read the customer's code. */
export const PayBarCodeDataSchema = z.looseObject({
  deviceNo: DeviceNoSchema,
  merchantNo: OptionalText(64),
  barCode: z.string().trim().min(1).max(64),
  productId: z.string().trim().min(1).max(64),
  productName: z.string().trim().min(1).max(128),
  orderNo: OrderNoSchema,
  orderAmount: AmountSchema,
  notifyUrl: NotifyUrlSchema.optional(),
  attach: OptionalText(256),
});

export type PayBarCodeData = z.infer<typeof PayBarCodeDataSchema>;

/** §3.4.2 — Order refund. */
export const RefundDataSchema = z.looseObject({
  deviceNo: DeviceNoSchema,
  merchantNo: OptionalText(64),
  platBillNo: OptionalText(64),
  orderNo: OrderNoSchema,
  refundAmount: AmountSchema,
  attach: OptionalText(256),
});

export type RefundData = z.infer<typeof RefundDataSchema>;

/** §3.5.2 — the machine reporting whether it actually made the drink. */
export const ProductDoneDataSchema = z.looseObject({
  deviceNo: DeviceNoSchema,
  merchantNo: OptionalText(64),
  platBillNo: OptionalText(64),
  productId: z.string().trim().min(1).max(64),
  orderNo: OrderNoSchema,
  orderAmount: AmountSchema.optional(),
  isFinish: z.enum([JetinnoFinishState.SUCCESS, JetinnoFinishState.ERROR]),
  attach: OptionalText(256),
});

export type ProductDoneData = z.infer<typeof ProductDoneDataSchema>;

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/** Normalise an amount that may arrive as a string or a JSON number. */
export function toMinor(amount: string | number): number {
  return typeof amount === "number" ? amount : Number.parseInt(amount, 10);
}
