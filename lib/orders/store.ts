import { randomBytes, randomUUID } from "node:crypto";

import { shared, sharedCounter } from "@/lib/store/memory";
import {
  FulfilmentState,
  OrderSource,
  OrderStatus,
  isTerminalOrderStatus,
  payWindowMs,
  type ExternalOrderRef,
  type Order,
  type OrderItem,
} from "./order";

/**
 * In-memory order store for the POC, mirroring lib/payments/store.ts.
 *
 * Not a database: state is lost on restart and is not shared between server
 * instances. Everything the rest of the app needs is behind these functions,
 * so a real table can replace the Maps without touching callers.
 *
 * The Maps are held on `globalThis` (see lib/store/memory.ts) because Next
 * compiles route handlers and pages into separate bundles, which would
 * otherwise each get their own copy.
 */

const orders = shared("orders", () => new Map<string, Order>());

/** payToken -> orderId. The QR carries the token; nothing else resolves it. */
const payTokens = shared("orders.payTokens", () => new Map<string, string>());

/**
 * "SOURCE:theirOrderNo" -> orderId.
 *
 * A vendor's order number is unique on their side, so this index is what makes
 * a retried request idempotent. Jetinno's machines retry on an 8-second
 * timeout (§2.1), and a retry that minted a second order would put two of our
 * orders behind one cup of coffee.
 */
const externalOrderNos = shared("orders.externalOrderNos", () => new Map<string, string>());

function externalKey(source: OrderSource, orderNo: string): string {
  return `${source}:${orderNo}`;
}

/** Matches the order numbers in the product brief, which start around #1042. */
const orderNumber = sharedCounter("orders.nextNumber", 1042);

/**
 * 32 url-safe characters from 24 random bytes.
 *
 * Long enough that guessing one is not a strategy: the token is the ONLY thing
 * standing between a stranger and someone else's order summary, so it has to
 * carry real entropy rather than be a tidy short code.
 */
function newPayToken(): string {
  return randomBytes(24).toString("base64url");
}

export function createOrder(params: {
  machineId: string;
  items: OrderItem[];
  total: string;
  currency: string;
  source?: OrderSource;
  external?: ExternalOrderRef | null;
}): Order {
  const now = new Date();
  const timestamp = now.toISOString();
  const source = params.source ?? OrderSource.MACHINE_API;
  const order: Order = {
    id: `ord_${randomUUID()}`,
    orderNumber: orderNumber.value++,
    machineId: params.machineId,
    items: params.items,
    total: params.total,
    currency: params.currency,
    status: OrderStatus.CREATED,
    payToken: newPayToken(),
    payTokenExpiresAt: new Date(now.getTime() + payWindowMs()).toISOString(),
    createdAt: timestamp,
    updatedAt: timestamp,
    paidAt: null,
    source,
    external: params.external ?? null,
    fulfilment: FulfilmentState.PENDING,
    notifiedAt: null,
  };
  orders.set(order.id, order);
  payTokens.set(order.payToken, order.id);
  if (order.external) {
    externalOrderNos.set(externalKey(source, order.external.orderNo), order.id);
  }
  return order;
}

/** Resolve a vendor's own order number back to our order. */
export function getOrderByExternalOrderNo(
  source: OrderSource,
  orderNo: string,
): Order | undefined {
  const orderId = externalOrderNos.get(externalKey(source, orderNo));
  return orderId ? orders.get(orderId) : undefined;
}

export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
}

/** Resolve the token from a machine's QR. Unknown token -> undefined. */
export function getOrderByPayToken(payToken: string): Order | undefined {
  const orderId = payTokens.get(payToken);
  return orderId ? orders.get(orderId) : undefined;
}

/**
 * Move an order to a new status. A PAID order is never changed again, so a
 * late or replayed FAILED/PENDING result cannot un-pay it.
 */
export function setOrderStatus(orderId: string, status: OrderStatus): Order | undefined {
  const existing = orders.get(orderId);
  if (!existing) return undefined;
  if (isTerminalOrderStatus(existing.status)) return existing;

  const updated: Order = {
    ...existing,
    status,
    updatedAt: new Date().toISOString(),
    paidAt: status === OrderStatus.PAID ? new Date().toISOString() : existing.paidAt,
  };
  orders.set(orderId, updated);
  return updated;
}

/**
 * Record what the machine said about making the drink (§3.5).
 *
 * Unlike payment status this is not terminal-protected, because a machine may
 * legitimately report ERROR after a partial pour and then SUCCESS on a retry.
 */
export function setOrderFulfilment(
  orderId: string,
  fulfilment: FulfilmentState,
): Order | undefined {
  const existing = orders.get(orderId);
  if (!existing) return undefined;

  const updated: Order = { ...existing, fulfilment, updatedAt: new Date().toISOString() };
  orders.set(orderId, updated);
  return updated;
}

/**
 * Stamp an order as having had its payment result delivered to the vendor.
 *
 * Returns undefined when it was already stamped, which is how the caller keeps
 * the callback at-most-once without holding a lock.
 */
export function markOrderNotified(orderId: string): Order | undefined {
  const existing = orders.get(orderId);
  if (!existing || existing.notifiedAt) return undefined;

  const updated: Order = { ...existing, notifiedAt: new Date().toISOString() };
  orders.set(orderId, updated);
  return updated;
}

/** Newest first. Used by the owner dashboard. */
export function listOrders(): Order[] {
  return [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Test helper. */
export function resetOrderStore() {
  orders.clear();
  payTokens.clear();
  externalOrderNos.clear();
  orderNumber.value = 1042;
}
