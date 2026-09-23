import { toMinorUnits } from "@/lib/orders/money";
import { OrderSource, type Order } from "@/lib/orders/order";
import { markOrderNotified } from "@/lib/orders/store";
import { logPayment, logPaymentError } from "@/lib/payments/log";

import { jetinnoConfig, type JetinnoConfig } from "./config";
import {
  JetinnoCode,
  JetinnoPayStatus,
  JetinnoPayType,
  RESPONSE_TIMEOUT_MS,
  type JetinnoPayStatus as PayStatus,
} from "./protocol";
import { CALLBACK_UNSIGNED_FIELDS, jetinnoTimestamp, signFields } from "./signature";

/**
 * The Payment Callback (§3.3): the one message we send rather than receive.
 *
 * This is the whole point of the integration. The machine has been waiting
 * since it drew the QR, and it has no other way to learn the outcome — §3.2.3
 * says so explicitly: a PAYING order gets its result "through the callback
 * interface in 3.3". If this request never lands, a customer who paid stands
 * in front of a machine that never pours.
 *
 * Two properties follow from that:
 *
 *   - It is sent only after AFS has confirmed the payment server-side. A
 *     customer reaching a success page is not evidence of anything.
 *   - It is at-most-once but retried: `notifiedAt` is stamped only after a
 *     machine has acknowledged, so a failed attempt stays eligible while a
 *     delivered one is never repeated.
 */

export interface NotifyOutcome {
  delivered: boolean;
  /** Why we did not send — absent when an attempt was actually made. */
  skipped?: "not-jetinno" | "no-notify-url" | "already-notified";
  attempts: number;
  returnCode?: string;
}

interface CallbackPayload {
  deviceNo: string;
  orderNo: string;
  orderAmount: string;
  payType: string;
  payStatus: PayStatus;
  platBillNo?: string;
  attach?: string;
}

function buildCallbackBody(config: JetinnoConfig, payload: CallbackPayload) {
  const time = jetinnoTimestamp();
  const data: Record<string, unknown> = {
    deviceNo: payload.deviceNo,
    orderNo: payload.orderNo,
    orderAmount: payload.orderAmount,
    payType: payload.payType,
    payStatus: payload.payStatus,
  };
  if (payload.platBillNo) data.platBillNo = payload.platBillNo;
  if (payload.attach) data.attach = payload.attach;

  // §3.3.2: payType is required here and so signed, unlike §3.1.2. platBillNo
  // and attach are optional and so, by §2.4 rule 6, sent but not signed.
  const sign = signFields({ username: config.username, time, ...data }, config.apikey, {
    exclude: CALLBACK_UNSIGNED_FIELDS,
  });

  return { username: config.username, time, sign, data };
}

/** One POST, bounded by the 8 seconds §2.1 allows a call in this protocol. */
async function postCallback(
  notifyUrl: string,
  body: unknown,
): Promise<{ ok: boolean; returnCode?: string; detail?: string }> {
  try {
    const response = await fetch(notifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RESPONSE_TIMEOUT_MS),
      cache: "no-store",
    });

    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }

    // A 200 carrying FAIL is a refusal, not a delivery. Treating it as success
    // would stamp notifiedAt and make sure we never tell the machine again.
    const parsed = (await response.json().catch(() => null)) as { returnCode?: string } | null;
    const returnCode = parsed?.returnCode;
    return { ok: returnCode === JetinnoCode.SUCCESS, returnCode };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

const RETRY_DELAYS_MS = [0, 500, 1_500];

function delay(ms: number): Promise<void> {
  return ms === 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Tell the machine how the payment ended.
 *
 * Safe to call more than once for the same order and safe to call for orders
 * that did not come from Jetinno — both are no-ops. That is deliberate: the
 * call sites are the result page and the AFS webhook, which fire independently
 * and in either order, and neither should have to know about the other.
 */
export async function notifyPaymentResult(
  order: Order,
  params: {
    payStatus: PayStatus;
    platBillNo?: string | null;
    env?: Record<string, string | undefined>;
  },
): Promise<NotifyOutcome> {
  if (order.source !== OrderSource.JETINNO || !order.external) {
    return { delivered: false, skipped: "not-jetinno", attempts: 0 };
  }
  if (!order.external.notifyUrl) {
    // §3.1.2 requires notifyUrl, but the schema tolerates its absence rather
    // than refuse a sale. With none there is nowhere for us to report to.
    logPayment("jetinno.callback.skipped", {
      orderId: order.id,
      jetinnoOrderNo: order.external.orderNo,
      reason: "no notifyUrl in the original request",
    });
    return { delivered: false, skipped: "no-notify-url", attempts: 0 };
  }
  if (order.notifiedAt) {
    return { delivered: false, skipped: "already-notified", attempts: 0 };
  }

  const config = jetinnoConfig(params.env ?? process.env);
  const body = buildCallbackBody(config, {
    deviceNo: order.external.deviceNo,
    orderNo: order.external.orderNo,
    // Back to the cents the machine stated, so their side reconciles exactly.
    orderAmount: String(toMinorUnits(order.total)),
    payType: order.external.payType ?? JetinnoPayType.QR,
    payStatus: params.payStatus,
    platBillNo: params.platBillNo ?? undefined,
    attach: order.external.attach ?? undefined,
  });

  let attempts = 0;
  let lastCode: string | undefined;

  for (const backoff of RETRY_DELAYS_MS) {
    await delay(backoff);
    attempts += 1;

    const result = await postCallback(order.external.notifyUrl, body);
    lastCode = result.returnCode;

    if (result.ok) {
      markOrderNotified(order.id);
      logPayment("jetinno.callback.delivered", {
        orderId: order.id,
        jetinnoOrderNo: order.external.orderNo,
        deviceNo: order.external.deviceNo,
        payStatus: params.payStatus,
        attempts,
      });
      return { delivered: true, attempts, returnCode: result.returnCode };
    }

    logPaymentError("jetinno.callback.attempt_failed", {
      orderId: order.id,
      jetinnoOrderNo: order.external.orderNo,
      attempt: attempts,
      returnCode: result.returnCode,
      detail: result.detail,
    });
  }

  // notifiedAt stays unset on purpose: the next trigger retries rather than
  // assuming the machine was told.
  logPaymentError("jetinno.callback.undelivered", {
    orderId: order.id,
    jetinnoOrderNo: order.external.orderNo,
    payStatus: params.payStatus,
    attempts,
  });

  return { delivered: false, attempts, returnCode: lastCode };
}

/** Translate a settled payment into the status the machine understands. */
export function payStatusFor(paid: boolean): PayStatus {
  return paid ? JetinnoPayStatus.PAYSUCCESS : JetinnoPayStatus.PAYERROR;
}
