/**
 * Order model. Deliberately independent of AFS: an order describes what the
 * customer bought from which machine, and nothing about how it was paid.
 *
 * Machine -> Order -> OrderItem, with Payment (lib/payments) hanging off the
 * order id.
 */

export const OrderStatus = {
  /** Created, no payment attempt started yet. */
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
  /** Short human reference shown to the customer and the owner. */
  orderNumber: number;
  machineId: string;
  items: OrderItem[];
  total: string;
  currency: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  paidAt: string | null;
}

/** PAID is terminal: nothing may move an order back out of it. */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === OrderStatus.PAID;
}
