import { getMachineByCode } from "@/lib/catalog/machines";
import { fromMinorUnits } from "@/lib/orders/money";
import {
  FulfilmentState,
  OrderSource,
  OrderStatus,
  type ExternalOrderRef,
  type Order,
  type OrderItem,
} from "@/lib/orders/order";
import {
  createOrder,
  getOrderByExternalOrderNo,
  setOrderFulfilment,
} from "@/lib/orders/store";
import { logPayment } from "@/lib/payments/log";
import { orderPayUrl, resolveQrBaseUrl } from "@/lib/qr/url";

import type { JetinnoConfig } from "./config";
import { JetinnoCode, JetinnoPayType, QR_CODE_MAX_LENGTH } from "./protocol";
import { toMinor, type GetQrCodeData, type PayBarCodeData, type ProductDoneData } from "./validation";

/**
 * Turning a Jetinno message into one of our orders.
 *
 * The inversion this file exists to handle: in our own machine API the server
 * prices the basket, and in Jetinno's protocol the machine does. §3.1.2 sends
 * `orderAmount` in cents and offers no field in which a server could answer
 * with a different price. So the amount is taken as stated, and two things
 * stand behind it instead:
 *
 *   - the MD5 signature, which proves the message came from a holder of the
 *     apikey and that the amount was not altered in flight;
 *   - `JETINNO_MAX_ORDER_MINOR`, which catches an amount that is authentic but
 *     absurd — a firmware decimal-point bug signs just as validly as a correct
 *     price does.
 */

/** Thrown for anything that maps to a specific §4.1 information code. */
export class JetinnoError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "JetinnoError";
    this.code = code;
  }
}

/**
 * Which of our machines a device number belongs to.
 *
 * An unmapped device is recorded as `jetinno:<deviceNo>` rather than refused:
 * the dashboard already renders an unknown machine id as itself, and a missing
 * row in a lookup table is not a reason to decline a sale.
 */
export function resolveMachineId(config: JetinnoConfig, deviceNo: string): string {
  const machineCode = config.deviceMap.get(deviceNo);
  const machine = machineCode ? getMachineByCode(machineCode) : undefined;
  return machine?.id ?? `jetinno:${deviceNo}`;
}

/** Their merchantNo must be ours, when both sides state one. */
function assertMerchant(config: JetinnoConfig, presented: string | undefined) {
  if (!config.merchantNo || !presented) return;
  if (presented !== config.merchantNo) {
    throw new JetinnoError(
      JetinnoCode.INVALID_REQUEST,
      "merchantNo does not match the configured merchant",
    );
  }
}

/** The amount, checked for sanity and converted to our decimal string form. */
function priceFromMachine(config: JetinnoConfig, amount: string | number): string {
  const minor = toMinor(amount);

  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new JetinnoError(JetinnoCode.PARAM_ERROR, "orderAmount must be a positive whole number of cents");
  }
  if (minor > config.maxOrderMinor) {
    throw new JetinnoError(
      JetinnoCode.PARAM_ERROR,
      `orderAmount ${minor} exceeds JETINNO_MAX_ORDER_MINOR (${config.maxOrderMinor})`,
    );
  }

  return fromMinorUnits(minor);
}

/**
 * One line, built from what the machine said it is selling.
 *
 * `productId` and `productName` are stored as the machine sent them and are
 * NOT looked up in our catalogue. The machine's slot list is the authority on
 * what it can pour; our catalogue describes a different machine's menu, and
 * validating one against the other would reject every real drink.
 */
function itemFromMachine(data: { productId: string; productName: string }, total: string): OrderItem {
  return {
    productId: data.productId,
    productName: data.productName,
    quantity: 1,
    unitPrice: total,
    totalPrice: total,
  };
}

function externalRef(
  data: GetQrCodeData | PayBarCodeData,
  payType: string | null,
): ExternalOrderRef {
  return {
    deviceNo: data.deviceNo,
    merchantNo: data.merchantNo ?? null,
    orderNo: data.orderNo,
    notifyUrl: data.notifyUrl ?? null,
    payType,
    attach: data.attach ?? null,
  };
}

export interface JetinnoOrderResult {
  order: Order;
  /** True when an existing order was returned instead of a new one. */
  replayed: boolean;
}

/**
 * Create — or re-serve — the order behind a getQrCode call (§3.1).
 *
 * Idempotent on their `orderNo`. Their machines time out after 8 seconds and
 * retry (§2.1); without this, a slow response would leave two of our orders
 * behind one cup of coffee and the customer able to pay the wrong one.
 *
 * A repeat of an order that is already PAID is refused with ORDER_PAY, because
 * at that point the machine is asking us to sell something already sold.
 */
export function createJetinnoOrder(params: {
  config: JetinnoConfig;
  data: GetQrCodeData;
  currency: string;
}): JetinnoOrderResult {
  const { config, data } = params;

  assertMerchant(config, data.merchantNo);

  const existing = getOrderByExternalOrderNo(OrderSource.JETINNO, data.orderNo);
  if (existing) {
    if (existing.status === OrderStatus.PAID) {
      throw new JetinnoError(JetinnoCode.ORDER_PAY, "Order has already been paid");
    }
    return { order: existing, replayed: true };
  }

  const total = priceFromMachine(config, data.orderAmount);
  const payType = data.payType ?? JetinnoPayType.QR;

  const order = createOrder({
    machineId: resolveMachineId(config, data.deviceNo),
    items: [itemFromMachine(data, total)],
    total,
    currency: params.currency,
    source: OrderSource.JETINNO,
    external: externalRef(data, payType),
  });

  logPayment("jetinno.order.created", {
    orderId: order.id,
    orderNumber: order.orderNumber,
    deviceNo: data.deviceNo,
    jetinnoOrderNo: data.orderNo,
    productId: data.productId,
    total: order.total,
    currency: order.currency,
    payType,
    hasNotifyUrl: Boolean(data.notifyUrl),
    payTokenExpiresAt: order.payTokenExpiresAt,
  });

  return { order, replayed: false };
}

/**
 * The string the machine draws as a QR (§3.1.3).
 *
 * It is our own payment page URL. The specification caps the field at 128
 * characters and says nothing about its content, and a pay URL is well inside
 * that — which is why this integration needs no QR product from the gateway.
 * If a gateway-issued QR payload is provisioned later it is swapped in here,
 * behind this one function, and nothing else in the flow changes.
 */
export async function qrCodeForOrder(order: Order): Promise<string> {
  const baseUrl = await resolveQrBaseUrl();
  if (!baseUrl) {
    throw new JetinnoError(
      JetinnoCode.SYSTEM_ERROR,
      "No public base URL is configured. Set APP_BASE_URL so the QR can be reached from a phone.",
    );
  }

  const payUrl = orderPayUrl(baseUrl, order.payToken);
  if (payUrl.length > QR_CODE_MAX_LENGTH) {
    // Fail loudly rather than hand back a truncated URL that scans to nothing.
    throw new JetinnoError(
      JetinnoCode.SYSTEM_ERROR,
      `Pay URL is ${payUrl.length} characters; the qrCode field holds ${QR_CODE_MAX_LENGTH}. Use a shorter APP_BASE_URL.`,
    );
  }

  return payUrl;
}

/**
 * Record a §3.5 completion report.
 *
 * A machine that took the money and failed to pour is the case this exists to
 * make visible: the order stays PAID — the customer really was charged — and
 * the fulfilment state carries the failure, which is what a refund is decided
 * from.
 */
export function recordFulfilment(data: ProductDoneData): Order {
  const order = getOrderByExternalOrderNo(OrderSource.JETINNO, data.orderNo);
  if (!order) {
    throw new JetinnoError(JetinnoCode.ORDER_NOT_EXIST, "No order matches that orderNo");
  }

  const state =
    data.isFinish === FulfilmentState.SUCCESS ? FulfilmentState.SUCCESS : FulfilmentState.ERROR;
  const updated = setOrderFulfilment(order.id, state) ?? order;

  logPayment("jetinno.fulfilment.reported", {
    orderId: updated.id,
    jetinnoOrderNo: data.orderNo,
    deviceNo: data.deviceNo,
    isFinish: data.isFinish,
    orderStatus: updated.status,
    // The one combination a human needs to see in a log.
    paidButNotPoured: updated.status === OrderStatus.PAID && state === FulfilmentState.ERROR,
  });

  return updated;
}

/** Look up an order by their order number, for refund and status paths. */
export function findJetinnoOrder(orderNo: string): Order {
  const order = getOrderByExternalOrderNo(OrderSource.JETINNO, orderNo);
  if (!order) {
    throw new JetinnoError(JetinnoCode.ORDER_NOT_EXIST, "No order matches that orderNo");
  }
  return order;
}
