import { getActiveProduct } from "@/lib/catalog/products";
import { getMachineById, type Machine } from "@/lib/catalog/machines";
import { notifyPaymentResult, payStatusFor } from "@/lib/jetinno/notify";
import { prepareCheckout, verifyPaymentByResourcePath, type PreparedCheckout, type VerifiedPayment } from "@/lib/payments/afs/service";
import { AfsError } from "@/lib/payments/afs/errors";
import { logPayment } from "@/lib/payments/log";
import { isMethodEnabled } from "@/lib/payments/methods";
import { PaymentMethod, PaymentStatus } from "@/lib/payments/payment";
import { getPaymentsByOrderId } from "@/lib/payments/store";
import { MoneyError, multiplyPrice, sumPrices } from "./money";
import { OrderSource, OrderStatus, isPayWindowOpen, type Order, type OrderItem } from "./order";
import { createOrder, getOrder, getOrderByPayToken, setOrderStatus } from "./store";

/**
 * Order orchestration: the layer that turns a machine's basket into an order,
 * an AFS checkout, and finally a verified payment.
 *
 * The flow, and who is allowed to say what:
 *
 *   the machine sends    which products, how many   (authenticated as itself)
 *   the phone sends      a payToken, a method
 *   the server decides   machine, prices, quantities' arithmetic, total,
 *                        currency, status, and whether the money arrived
 *
 * The machine is resolved from its API key, so a machine cannot book an order
 * against a different machine. The customer's phone never names a machine, a
 * product or a price at all — it holds one opaque token that resolves to one
 * already-priced order. There is nothing in the payment request left to tamper
 * with.
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

/** What a machine asks for: products and quantities, never prices. */
export interface OrderLineRequest {
  productId: string;
  quantity: number;
}

/**
 * Create the order a customer just assembled on the machine.
 *
 * `machine` is already authenticated by the caller — this function does not
 * accept a machine identifier from any payload, because a payload cannot prove
 * which machine it came from.
 *
 * Prices come from the catalogue and the line arithmetic is done in integer
 * minor units, so the total is the server's own answer end to end.
 */
export function createMachineOrder(params: {
  machine: Machine;
  lines: OrderLineRequest[];
}): Order {
  if (params.lines.length === 0) {
    throw new OrderError("An order needs at least one line", 400, "Your order is empty.");
  }

  // Two taps on the same drink are one line of quantity 2, not two lines.
  const merged = new Map<string, number>();
  for (const line of params.lines) {
    merged.set(line.productId, (merged.get(line.productId) ?? 0) + line.quantity);
  }

  const items: OrderItem[] = [];
  let currency: string | null = null;

  for (const [productId, quantity] of merged) {
    const product = getActiveProduct(productId);
    if (!product) {
      throw new OrderError(
        `Unknown or inactive product ${productId}`,
        404,
        "That product is not available.",
      );
    }
    // One order cannot mix currencies: AFS charges a single amount in a single
    // currency, so a mixed basket has no correct total to send.
    if (currency && product.currency !== currency) {
      throw new OrderError(
        "Order mixes currencies",
        400,
        "Those drinks cannot be bought in one order.",
      );
    }
    currency = product.currency;

    items.push({
      productId: product.id,
      productName: product.name,
      quantity,
      unitPrice: product.price,
      totalPrice: multiplyPrice(product.price, quantity),
    });
  }

  let total: string;
  try {
    total = sumPrices(items.map((item) => item.totalPrice));
  } catch (error) {
    // A catalogue price that cannot be totalled is our bug, not the customer's.
    if (error instanceof MoneyError) {
      throw new OrderError(error.message, 500, "This order could not be priced.");
    }
    throw error;
  }

  const order = createOrder({
    machineId: params.machine.id,
    currency: currency as string,
    total,
    items,
  });

  logPayment("order.created", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    machineId: params.machine.id,
    machineCode: params.machine.code,
    lines: items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    total: order.total,
    currency: order.currency,
    payTokenExpiresAt: order.payTokenExpiresAt,
  });

  return order;
}

export interface ScannedOrder {
  order: Order;
  machine: Machine;
}

/**
 * Resolve the token a customer just scanned into the order it names.
 *
 * Used by the payment page to render the summary, so it deliberately does NOT
 * check the pay window — an expired order should be shown with an honest
 * "this has expired" instead of a 404 that looks like a broken QR.
 */
export function resolveScannedOrder(payToken: string): ScannedOrder {
  const order = getOrderByPayToken(payToken);
  if (!order) {
    throw new OrderError("Unknown pay token", 404, "This code is not valid.");
  }

  const machine = getMachineById(order.machineId);
  if (!machine) {
    throw new OrderError("Order references an unknown machine", 404, "This code is not valid.");
  }

  return { order, machine };
}

/**
 * Start (or restart) a payment attempt for a scanned order.
 *
 * An order that is already PAID never gets another checkout: that is the front
 * line of the "one AFS payment, one paid order" rule. An order past its pay
 * window gets none either, so a photographed QR stops working.
 */
export async function startOrderPayment(params: {
  payToken: string;
  method: PaymentMethod;
  shopperResultUrl: string;
  customerIp?: string | null;
}): Promise<{ order: Order; machine: Machine; checkout: PreparedCheckout }> {
  const { order, machine } = resolveScannedOrder(params.payToken);

  if (order.status === OrderStatus.PAID) {
    throw new OrderError("Order is already paid", 409, "This order has already been paid.");
  }
  if (!isPayWindowOpen(order)) {
    throw new OrderError(
      "Pay window has closed",
      410,
      "This code has expired. Start again on the machine.",
    );
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
    // Authoritative amount: straight off the order the machine's basket built.
    amount: order.total,
    shopperResultUrl: params.shopperResultUrl,
    machineId: machine.id,
    orderId: order.id,
    method: params.method,
    customerIp: params.customerIp,
  });

  setOrderStatus(order.id, OrderStatus.AWAITING_PAYMENT);

  return { order, machine, checkout };
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
 *
 * The pay window is NOT enforced here. The customer may return from a 3-D
 * Secure challenge after it closed, and refusing to confirm a payment AFS has
 * already taken would be the worst possible outcome.
 */
export async function verifyOrderPayment(params: {
  payToken: string;
  resourcePath: string;
}): Promise<OrderPaymentResult> {
  const { order: scanned, machine } = resolveScannedOrder(params.payToken);

  const payment = await verifyPaymentByResourcePath(params.resourcePath);

  // The token in the URL and the checkout AFS is reporting on must describe the
  // same order. Without this, someone holding their own valid pay token could
  // point the result page at another customer's checkout.
  if (payment.orderId !== scanned.id) {
    throw new OrderError(
      "Payment does not belong to this order",
      403,
      "This payment belongs to a different order.",
    );
  }

  const order =
    payment.status === PaymentStatus.SUCCESS
      ? setOrderStatus(scanned.id, OrderStatus.PAID)
      : settleUnsuccessful(scanned.id, payment.status);

  const settled = order ?? scanned;

  // A vendor machine is still standing there waiting to be told. Only a
  // decided outcome is reported: PENDING means the customer is mid-challenge,
  // and telling a machine PAYERROR then would cancel a payment still in
  // progress.
  if (payment.status !== PaymentStatus.PENDING) {
    await reportToVendor(settled, payment);
  }

  return { order: settled, machine, payment };
}

/**
 * Deliver the payment result to the machine's own platform, when the order came
 * from one (Jetinno §3.3).
 *
 * Never allowed to fail the caller. The customer's payment is already settled
 * with AFS by this point, and a callback we could not deliver is a delivery
 * problem — logged, and retried by the next trigger — not a reason to show
 * someone who just paid an error page.
 */
async function reportToVendor(order: Order, payment: VerifiedPayment): Promise<void> {
  if (order.source !== OrderSource.JETINNO) return;

  try {
    await notifyPaymentResult(order, {
      payStatus: payStatusFor(payment.status === PaymentStatus.SUCCESS),
      platBillNo: payment.transactionId,
    });
  } catch (error) {
    logPayment("jetinno.callback.errored", {
      orderId: order.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
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

/**
 * What a machine is told when it polls its own order. Deliberately narrow: the
 * machine needs to know whether to pour a drink, not who paid or how.
 */
export interface MachineOrderView {
  orderId: string;
  orderNumber: number;
  status: OrderStatus;
  total: string;
  currency: string;
  items: OrderItem[];
  paidAt: string | null;
  payTokenExpiresAt: string;
  /** True exactly when the machine should dispense. */
  dispense: boolean;
}

/**
 * Read an order back for the machine that created it.
 *
 * The machine must be the one that owns the order — a machine holding a valid
 * key still cannot read another machine's orders.
 */
export function machineOrderView(machine: Machine, orderId: string): MachineOrderView {
  const order = getOrder(orderId);
  if (!order) {
    throw new OrderError("Unknown order", 404, "This order could not be found.");
  }
  if (order.machineId !== machine.id) {
    throw new OrderError(
      "Order belongs to a different machine",
      403,
      "This order belongs to a different machine.",
    );
  }

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    total: order.total,
    currency: order.currency,
    items: order.items,
    paidAt: order.paidAt,
    payTokenExpiresAt: order.payTokenExpiresAt,
    dispense: order.status === OrderStatus.PAID,
  };
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
