import { randomUUID } from "node:crypto";

import { shared, sharedCounter } from "@/lib/store/memory";
import { OrderStatus, isTerminalOrderStatus, type Order, type OrderItem } from "./order";

/**
 * In-memory order store for the POC, mirroring lib/payments/store.ts.
 *
 * Not a database: state is lost on restart and is not shared between server
 * instances. Everything the rest of the app needs is behind these functions,
 * so a real table can replace the Map without touching callers.
 *
 * The Map is held on `globalThis` (see lib/store/memory.ts) because Next
 * compiles route handlers and pages into separate bundles, which would
 * otherwise each get their own copy.
 */

const orders = shared("orders", () => new Map<string, Order>());

/** Matches the order numbers in the product brief, which start around #1042. */
const orderNumber = sharedCounter("orders.nextNumber", 1042);

export function createOrder(params: {
  machineId: string;
  items: OrderItem[];
  total: string;
  currency: string;
}): Order {
  const now = new Date().toISOString();
  const order: Order = {
    id: `ord_${randomUUID()}`,
    orderNumber: orderNumber.value++,
    machineId: params.machineId,
    items: params.items,
    total: params.total,
    currency: params.currency,
    status: OrderStatus.CREATED,
    createdAt: now,
    updatedAt: now,
    paidAt: null,
  };
  orders.set(order.id, order);
  return order;
}

export function getOrder(orderId: string): Order | undefined {
  return orders.get(orderId);
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

/** Newest first. Used by the owner dashboard. */
export function listOrders(): Order[] {
  return [...orders.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Test helper. */
export function resetOrderStore() {
  orders.clear();
  orderNumber.value = 1042;
}
