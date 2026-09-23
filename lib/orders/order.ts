/**
 * Order model. Deliberately independent of AFS: an order describes what the
 * customer bought from which machine, and nothing about how it was paid.
 *
 * Machine -> Order -> OrderItem, with Payment (lib/payments) hanging off the
 * order id.
 *
 * An order carries its own `payToken`. That token — not the machine — is what
 * the QR on the machine screen encodes, so scanning it opens exactly one
 * order's payment page. It is per-order and short-lived, which means a
 * photographed QR is worthless a few minutes later and cannot be reused to pay
 * for a different drink.
 */

export const OrderStatus = {
  /** Created by a machine, no payment attempt started yet. */
  CREATED: "CREATED",
  /** An AFS checkout exists and the customer is paying. */
  AWAITING_PAYMENT: "AWAITING_PAYMENT",
  /** A payment was verified SUCCESS server-side. Terminal. */
  PAID: "PAID",
  /** Every payment attempt failed. Not terminal — the customer may retry. */
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * Who created the order, which decides who priced it.
 *
 * MACHINE_API — our own interface. The machine names products and quantities,
 * the server reads prices from the catalogue. The server is the only authority
 * on what anything costs.
 *
 * JETINNO — the IOT Payment Universal Interface. Their machine prices its own
 * basket and states `orderAmount` in the request. That is their protocol, not
 * our choice: §3.1.2 has no shape in which the server could price anything.
 * The MD5 signature over the apikey is what authenticates the amount, and
 * `JETINNO_MAX_ORDER_MINOR` is the sanity bound behind it.
 */
export const OrderSource = {
  MACHINE_API: "MACHINE_API",
  JETINNO: "JETINNO",
} as const;

export type OrderSource = (typeof OrderSource)[keyof typeof OrderSource];

/**
 * An order's identity in the vendor platform that created it.
 *
 * `orderNo` is their number and is globally unique on their side, which makes
 * it our idempotency key: a retried getQrCode must return the same QR, not a
 * second order.
 *
 * `notifyUrl` is the single most important field here. It arrives per request
 * (§3.1.2) and is where we POST the payment result (§3.3.1) — the machine
 * tells us where to report, we do not configure it.
 */
export interface ExternalOrderRef {
  deviceNo: string;
  merchantNo: string | null;
  orderNo: string;
  notifyUrl: string | null;
  payType: string | null;
  attach: string | null;
}

/**
 * Whether the machine actually made the drink, as reported by §3.5.
 *
 * Distinct from payment status on purpose: a paid order whose machine failed
 * to pour is precisely the case that needs a refund, and it is invisible if
 * the two are collapsed into one field.
 */
export const FulfilmentState = {
  /** Not reported yet. Every order starts here. */
  PENDING: "PENDING",
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
} as const;

export type FulfilmentState = (typeof FulfilmentState)[keyof typeof FulfilmentState];

export interface OrderItem {
  productId: string;
  /** Snapshot: the catalogue may change after the order was placed. */
  productName: string;
  quantity: number;
  unitPrice: string;
  totalPrice: string;
}

export interface Order {
  id: string;
  /** Short human reference shown on the machine, the phone and the dashboard. */
  orderNumber: number;
  machineId: string;
  items: OrderItem[];
  total: string;
  currency: string;
  status: OrderStatus;
  /** Opaque, unguessable, url-safe. This is what the machine's QR carries. */
  payToken: string;
  /** After this, the QR no longer starts a payment. */
  payTokenExpiresAt: string;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
  /** Which interface created this order, and therefore who priced it. */
  source: OrderSource;
  /** Set only for orders that originated in a vendor platform. */
  external: ExternalOrderRef | null;
  /** What the machine reported about actually making the drink. */
  fulfilment: FulfilmentState;
  /** When we successfully delivered the payment result to `notifyUrl`. */
  notifiedAt: string | null;
}

/** PAID is terminal: nothing may move an order back out of it. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === OrderStatus.PAID;
}

/** How long a machine's QR stays scannable. */
export const DEFAULT_PAY_WINDOW_MINUTES = 15;

export function payWindowMs(env: Record<string, string | undefined> = process.env): number {
  const configured = Number.parseInt(env.ORDER_PAY_WINDOW_MINUTES?.trim() ?? "", 10);
  const minutes =
    Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_PAY_WINDOW_MINUTES;
  return minutes * 60_000;
}

/**
 * Whether the QR may still START a payment.
 *
 * Note what this does NOT gate: verifying a payment that is already under way.
 * A customer who tapped their card at 14:59 must still get their order settled
 * at 15:01, so expiry is checked when a checkout is created and never again.
 */
export function isPayWindowOpen(order: Order, now: Date = new Date()): boolean {
  return now.getTime() < Date.parse(order.payTokenExpiresAt);
}
