import { shared } from "@/lib/store/memory";
import { isTerminalPaymentStatus, type PaymentRecord } from "./payment";

/**
 * In-memory payment store for the POC.
 *
 * Deliberately not a database: everything the rest of the code needs is behind
 * these functions, so a real table can replace the Maps without touching the
 * AFS client or the API routes. State is lost on server restart and is not
 * shared between instances.
 *
 * The Maps are held on `globalThis` (see lib/store/memory.ts) because Next
 * compiles route handlers and pages into separate bundles, which would
 * otherwise each get their own copy — a payment created by the checkout route
 * would then be invisible to the result page that has to verify it.
 */

const payments = shared("payments", () => new Map<string, PaymentRecord>());
/** orderId -> checkoutIds, newest last. One order may have several attempts. */
const paymentsByOrder = shared("payments.byOrder", () => new Map<string, string[]>());
/** Notification ids already handled, so webhook processing stays idempotent. */
const processedNotifications = shared("payments.notifications", () => new Set<string>());

export function savePayment(record: PaymentRecord): PaymentRecord {
  payments.set(record.checkoutId, record);
  if (record.orderId) {
    const existing = paymentsByOrder.get(record.orderId) ?? [];
    if (!existing.includes(record.checkoutId)) {
      paymentsByOrder.set(record.orderId, [...existing, record.checkoutId]);
    }
  }
  return record;
}

export function getPaymentByCheckoutId(checkoutId: string): PaymentRecord | undefined {
  return payments.get(checkoutId);
}

/** Every attempt made against one order, oldest first. */
export function getPaymentsByOrderId(orderId: string): PaymentRecord[] {
  return (paymentsByOrder.get(orderId) ?? [])
    .map((checkoutId) => payments.get(checkoutId))
    .filter((record): record is PaymentRecord => record !== undefined);
}

/** The verified successful attempt for an order, if there is one. */
export function getSuccessfulPaymentForOrder(orderId: string): PaymentRecord | undefined {
  return getPaymentsByOrderId(orderId).find((record) => isTerminalPaymentStatus(record.status));
}

/**
 * Patch a payment. A payment that has already reached a terminal status is
 * returned unchanged: a refreshed result page, a retried verification or a
 * replayed webhook must never rewrite a settled payment.
 */
export function updatePayment(
  checkoutId: string,
  patch: Partial<Omit<PaymentRecord, "checkoutId" | "createdAt" | "orderId">>,
): PaymentRecord | undefined {
  const existing = payments.get(checkoutId);
  if (!existing) return undefined;
  if (isTerminalPaymentStatus(existing.status)) return existing;

  const updated: PaymentRecord = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  payments.set(checkoutId, updated);
  return updated;
}

/** Newest first. Used by the owner dashboard. */
export function listPayments(): PaymentRecord[] {
  return [...payments.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Returns false when this notification id was already processed. */
export function markNotificationProcessed(notificationId: string): boolean {
  if (processedNotifications.has(notificationId)) return false;
  processedNotifications.add(notificationId);
  return true;
}

/** Test helper. */
export function resetPaymentStore() {
  payments.clear();
  paymentsByOrder.clear();
  processedNotifications.clear();
}
