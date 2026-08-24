import { getActiveProduct } from "@/lib/catalog/products";
import { getMachineByPublicToken, type Machine } from "@/lib/catalog/machines";
import { prepareCheckout, verifyPaymentByResourcePath, type PreparedCheckout, type VerifiedPayment } from "@/lib/payments/afs/service";
import { AfsError } from "@/lib/payments/afs/errors";
import { logPayment } from "@/lib/payments/log";
import { isMethodEnabled } from "@/lib/payments/methods";
import { PaymentMethod, PaymentStatus } from "@/lib/payments/payment";
import { getPaymentsByOrderId } from "@/lib/payments/store";
import { OrderStatus, type Order } from "./order";
import { createOrder, getOrder, setOrderStatus } from "./store";

/**
 * Order orchestration: the layer that turns a scanned QR token plus a product
 * id into an order, an AFS checkout, and finally a verified payment.
 *
 * This is where the "never trust the browser" rule is enforced:
 *
 *   the browser may send   machineToken, productId, orderId, method
 *   the server decides     machine, product, price, currency, amount, status
 *
 * The machine is resolved from the opaque QR token, so editing the URL cannot
 * attach an order to a different machine — an unknown token does not resolve
 * at all. The amount is read from the product catalogue, so a tampered price
 * in the browser is simply never consulted.
 */

/** Thrown for order-level problems, mapped to a status code by the caller. */
export class OrderError extends Error {
  readonly httpStatus: number;
  readonly publicMessage: string;

  constructor(message: string, httpStatus = 400, publicMessage?: string) {
    super(message);
    this.name = "OrderError";
    this.httpStatus = httpStatus;
    this.publicMessage = publicMessage ?? message;
  }
}

/** Resolve a QR token to a machine, or fail. Never returns a guess. */
export function requireMachine(machineToken: string): Machine {
  const machine = getMachineByPublicToken(machineToken);
  if (!machine) {
    throw new OrderError("Unknown machine token", 404, "This machine could not be found.");
  }
  return machine;
}

/**
 * Create an order for one unit of one product at the scanned machine.
 *
 * Quantity is fixed at 1 for the MVP. The unit price is snapshotted onto the
 * order item so a later catalogue change cannot rewrite history.
 */
export function createMachineOrder(params: { machineToken: string; productId: string }): Order {
  const machine = requireMachine(params.machineToken);

  const product = getActiveProduct(params.productId);
  if (!product) {
    throw new OrderError("Unknown or inactive product", 404, "That product is not available.");
  }

  const order = createOrder({
    machineId: machine.id,
    currency: product.currency,
    // Quantity is 1, so the line total is the unit price. Kept explicit so a
    // future quantity > 1 has an obvious place to land.
    total: product.price,
    items: [
      {
        productId: product.id,
        productName: product.name,
        quantity: 1,
        unitPrice: product.price,
        totalPrice: product.price,
      },
    ],
  });

  logPayment("order.created", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    machineId: machine.id,
    machineCode: machine.code,
    productId: product.id,
    total: order.total,
    currency: order.currency,
  });

  return order;
}

/**
 * Start (or restart) a payment attempt for an order.
 *
 * An order that is already PAID never gets another checkout: that is the
 * front line of the "one AFS payment, one paid order" rule.
 */
export async function startOrderPayment(params: {
  machineToken: string;
  orderId: string;
  method: PaymentMethod;
  shopperResultUrl: string;
  customerIp?: string | null;
}): Promise<{ order: Order; checkout: PreparedCheckout }> {
  const machine = requireMachine(params.machineToken);

  const order = getOrder(params.orderId);
  if (!order) {
    throw new OrderError("Unknown order", 404, "This order could not be found.");
  }
  // The order remembers which machine it belongs to. A token for a different
  // machine cannot adopt it.
  if (order.machineId !== machine.id) {
    throw new OrderError(
      "Order does not belong to this machine",
      403,
      "This order belongs to a different machine.",
    );
  }
  if (order.status === OrderStatus.PAID) {
    throw new OrderError("Order is already paid", 409, "This order has already been paid.");
  }

  // A method the merchant account cannot actually take must never reach AFS.
  if (!isMethodEnabled(params.method)) {
    throw new OrderError(
      `Payment method ${params.method} is not enabled for this merchant`,
      400,
      "That payment method is not available.",
    );
  }

  const checkout = await prepareCheckout({
    // Authoritative amount: straight off the order the server built.
    amount: order.total,
    shopperResultUrl: params.shopperResultUrl,
    machineId: machine.id,
    orderId: order.id,
    method: params.method,
    customerIp: params.customerIp,
  });

  setOrderStatus(order.id, OrderStatus.AWAITING_PAYMENT);

  return { order, checkout };
}

export interface OrderPaymentResult {
  order: Order;
  machine: Machine;
  payment: VerifiedPayment;
}

/**
 * Verify a returning shopper's payment with AFS and settle the order.
 *
 * Safe to call any number of times for the same resourcePath: the AFS service
 * short-circuits an already-settled payment, and `setOrderStatus` refuses to
 * move an order out of PAID. Refreshing the result page therefore produces
 * exactly one paid order and exactly one payment record.
 */
export async function verifyOrderPayment(params: {
  machineToken: string;
  resourcePath: string;
}): Promise<OrderPaymentResult> {
  const machine = requireMachine(params.machineToken);

  const payment = await verifyPaymentByResourcePath(params.resourcePath);

  if (payment.machineId !== machine.id) {
    throw new OrderError(
      "Payment does not belong to this machine",
      403,
      "This payment belongs to a different machine.",
    );
  }

  if (!payment.orderId) {
    throw new OrderError("Payment is not attached to an order", 404, "This order could not be found.");
  }

  const existing = getOrder(payment.orderId);
  if (!existing) {
    throw new OrderError("Unknown order", 404, "This order could not be found.");
  }

  const order =
    payment.status === PaymentStatus.SUCCESS
      ? setOrderStatus(existing.id, OrderStatus.PAID)
      : settleUnsuccessful(existing.id, payment.status);

  return { order: order ?? existing, machine, payment };
}

/**
 * Move an order out of AWAITING_PAYMENT when an attempt did not succeed. A
 * still-pending attempt leaves the order where it is, because the customer may
 * yet complete it.
 */
function settleUnsuccessful(orderId: string, status: PaymentStatus): Order | undefined {
  if (status === PaymentStatus.PENDING) return getOrder(orderId);
  if (status === PaymentStatus.CANCELLED) return setOrderStatus(orderId, OrderStatus.CANCELLED);
  return setOrderStatus(orderId, OrderStatus.FAILED);
}

/** Attempts made against an order, for the owner dashboard. */
export function orderPayments(orderId: string) {
  return getPaymentsByOrderId(orderId);
}

/** Map any thrown error to { status, message } for a route handler. */
export function orderErrorStatus(error: unknown): { status: number; message: string } {
  if (error instanceof OrderError) {
    return { status: error.httpStatus, message: error.publicMessage };
  }
  if (error instanceof AfsError) {
    return { status: error.httpStatus, message: error.publicMessage };
  }
  return { status: 500, message: "Unexpected payment error." };
}
