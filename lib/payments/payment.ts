/**
 * Internal payment model, deliberately independent of AFS. A future database
 * table or a second payment provider can be introduced without touching this.
 */

export const PaymentStatus = {
  /** Our record exists; the provider checkout has not been created yet. */
  CREATED: "CREATED",
  /** A provider checkout exists and the customer is paying. */
  PENDING: "PENDING",
  /** Verified server-side with the provider. Terminal. */
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  /** Terminal. Nothing in this POC sets it yet — refunds are out of scope. */
  REFUNDED: "REFUNDED",
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

/**
 * Once a payment reaches one of these, no later verification, retry or
 * replayed webhook may change it. This is what stops a duplicate callback
 * from un-paying a paid order.
 */
const TERMINAL_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.SUCCESS,
  PaymentStatus.REFUNDED,
]);

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Payment methods the application understands. CARD is the only one AFS has
 * provisioned on the current entity — see lib/payments/methods.ts, which is
 * the single place that decides what is actually offered.
 */
export const PaymentMethod = {
  CARD: "CARD",
  APPLE_PAY: "APPLE_PAY",
  GOOGLE_PAY: "GOOGLE_PAY",
} as const;

export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

/** Human label for the customer receipt and the owner dashboard. */
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  CARD: "Card",
  APPLE_PAY: "Apple Pay",
  GOOGLE_PAY: "Google Pay",
};

export const PaymentProvider = {
  AFS: "AFS",
} as const;

export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export interface PaymentRecord {
  /** Our own reference, sent to AFS as merchantTransactionId. */
  merchantTransactionId: string;
  /** The order this attempt pays for. Null for the standalone /payment-test POC page. */
  orderId: string | null;
  provider: PaymentProvider;
  /** AFS checkout id, known as soon as the checkout is prepared. */
  checkoutId: string;
  /** AFS transaction id, taken verbatim from the AFS payment response `id`. */
  transactionId: string | null;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: string;
  currency: string;
  /** Resolved server-side from the machine's QR token; never sent by the browser. */
  machineId: string;
  resultCode: string | null;
  resultDescription: string | null;
  paymentBrand: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the server last confirmed this payment with the provider. */
  verifiedAt: string | null;
}

/**
 * The only payment shape ever sent to the browser. No card data, no tokens,
 * no raw gateway payload.
 */
export interface PaymentResultView {
  status: PaymentStatus;
  amount: string;
  currency: string;
  transactionId: string | null;
  resultCode: string | null;
  resultMessage: string | null;
  paymentBrand: string | null;
  /** True when AFS accepted the payment but flagged it for manual review. */
  needsManualReview: boolean;
}
