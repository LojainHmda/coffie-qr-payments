import { randomUUID } from "node:crypto";

import { logPayment, logPaymentError } from "../log";
import { brandsForMethod } from "../methods";
import {
  PaymentMethod,
  PaymentProvider,
  PaymentStatus,
  isTerminalPaymentStatus,
  type PaymentRecord,
  type PaymentResultView,
} from "../payment";
import { getPaymentByCheckoutId, savePayment, updatePayment } from "../store";
import { afsRequest } from "./client";
import { getAfsConfig } from "./config";
import {
  AFS_CHECKOUTS_PATH,
  AFS_PAYMENT_TYPE_DEBIT,
  AFS_PAYMENT_WIDGET_SCRIPT_PATH,
  TEST_CUSTOMER,
  TEST_MACHINE_ID,
  TEST_PAYMENT_AMOUNT,
} from "./constants";
import { AfsError } from "./errors";
import type { AfsCheckoutResponse, AfsPaymentStatusResponse } from "./types";
import { isCheckoutCreated, verifyPayment } from "./verification";

/**
 * Application-level AFS operations. Route handlers and server components call
 * only this module; they never talk to AFS directly and never see the token.
 *
 * This module is provider-specific on purpose and knows nothing about orders.
 * Order orchestration lives in lib/orders/checkout.ts.
 */

export interface PreparedCheckout {
  checkoutId: string;
  amount: string;
  currency: string;
  /** Subresource-integrity hash for the widget script, when AFS returns one. */
  integrity: string | null;
  /** Public widget URL for the configured (TEST) environment. */
  widgetScriptUrl: string;
  shopperResultUrl: string;
  brands: string;
}

export interface PrepareCheckoutParams {
  /** Server-owned. Never sourced from the browser. */
  amount: string;
  shopperResultUrl: string;
  machineId: string;
  orderId: string | null;
  method: PaymentMethod;
  /** Shopper IPv4 address, when the request carries a usable one. */
  customerIp?: string | null;
}

/**
 * Create an AFS Copy&Pay checkout and record the payment attempt.
 *
 * The amount arrives already resolved by the caller from server-side data (the
 * product catalogue, or the POC constant) — nothing about it comes from the
 * browser.
 */
export async function prepareCheckout(params: PrepareCheckoutParams): Promise<PreparedCheckout> {
  const config = getAfsConfig();
  const merchantTransactionId = `coffee-${randomUUID()}`;

  const form: Record<string, string> = {
    entityId: config.entityId,
    amount: params.amount,
    currency: config.currency,
    paymentType: AFS_PAYMENT_TYPE_DEBIT,
    merchantTransactionId,
    // shopperResultUrl is deliberately NOT sent here. With Copy&Pay the widget
    // submits it from the form action, and AFS rejects the payment with
    // "shopperResultUrl was already set and cannot be overwritten" if the
    // checkout carries it too — the payment then never executes and the
    // status lookup reports no payment session.
    // Ask AFS for the SRI hash of the widget script.
    integrity: "true",
    // 3-D Secure 2 needs customer/billing data on the checkout.
    ...TEST_CUSTOMER,
  };

  if (params.customerIp) {
    form["customer.ip"] = params.customerIp;
  }

  const { data } = await afsRequest<AfsCheckoutResponse>(config, {
    path: AFS_CHECKOUTS_PATH,
    method: "POST",
    form,
  });

  const code = data.result?.code;
  if (!isCheckoutCreated(code) || !data.id) {
    logPaymentError("afs.checkout.rejected", {
      resultCode: code,
      resultDescription: data.result?.description,
      parameterErrors: data.result?.parameterErrors?.map((error) => ({
        name: error.name,
        message: error.message,
      })),
    });
    throw new AfsError("AFS_REJECTED", `AFS refused to create the checkout (${code ?? "no code"})`, {
      publicMessage: data.result?.description ?? "The payment gateway refused to start a payment.",
      httpStatus: 502,
      details: { resultCode: code },
    });
  }

  const now = new Date().toISOString();
  const record: PaymentRecord = {
    merchantTransactionId,
    orderId: params.orderId,
    provider: PaymentProvider.AFS,
    checkoutId: data.id,
    transactionId: null,
    method: params.method,
    status: PaymentStatus.PENDING,
    amount: params.amount,
    currency: config.currency,
    machineId: params.machineId,
    resultCode: code ?? null,
    resultDescription: data.result?.description ?? null,
    paymentBrand: null,
    createdAt: now,
    updatedAt: now,
    verifiedAt: null,
  };
  savePayment(record);

  logPayment("afs.checkout.created", {
    checkoutId: record.checkoutId,
    merchantTransactionId,
    orderId: record.orderId,
    machineId: record.machineId,
    method: record.method,
    amount: record.amount,
    currency: record.currency,
    resultCode: code,
  });

  return {
    checkoutId: data.id,
    amount: params.amount,
    currency: config.currency,
    integrity: data.integrity ?? null,
    widgetScriptUrl: new URL(
      `${AFS_PAYMENT_WIDGET_SCRIPT_PATH}?checkoutId=${encodeURIComponent(data.id)}`,
      config.baseUrl,
    ).toString(),
    shopperResultUrl: params.shopperResultUrl,
    brands: brandsForMethod(params.method),
  };
}

/**
 * The original standalone POC checkout used by /payment-test. Kept so the AFS
 * round-trip keeps a regression harness that does not depend on the
 * machine/order flow.
 */
export function prepareTestCheckout(params: {
  shopperResultUrl: string;
  machineId?: string;
  customerIp?: string | null;
}): Promise<PreparedCheckout> {
  return prepareCheckout({
    amount: TEST_PAYMENT_AMOUNT,
    shopperResultUrl: params.shopperResultUrl,
    machineId: params.machineId ?? TEST_MACHINE_ID,
    orderId: null,
    method: PaymentMethod.CARD,
    customerIp: params.customerIp,
  });
}

/**
 * AFS appends `resourcePath` to the shopperResultUrl. It arrives from the
 * browser, so it is validated against the documented shape before being used
 * to build a request URL.
 */
const RESOURCE_PATH_PATTERN = /^\/v1\/checkouts\/[A-Za-z0-9._-]+\/payment$/;

export function parseResourcePath(resourcePath: string): { checkoutId: string } {
  const trimmed = resourcePath.trim();
  if (!RESOURCE_PATH_PATTERN.test(trimmed)) {
    throw new AfsError("VERIFICATION", "resourcePath does not match the documented AFS format", {
      publicMessage: "Invalid payment reference.",
      httpStatus: 400,
    });
  }
  const checkoutId = trimmed.split("/")[3];
  return { checkoutId };
}

export interface VerifiedPayment extends PaymentResultView {
  checkoutId: string;
  orderId: string | null;
  method: PaymentMethod;
  machineId: string;
  /** Set when AFS reported a different amount/currency than we requested. */
  mismatches: string[];
  /** True when this call reused a settled record instead of asking AFS again. */
  fromCache: boolean;
}

function toView(record: PaymentRecord, mismatches: string[], fromCache: boolean): VerifiedPayment {
  return {
    checkoutId: record.checkoutId,
    orderId: record.orderId,
    method: record.method,
    machineId: record.machineId,
    status: record.status,
    amount: record.amount,
    currency: record.currency,
    transactionId: record.transactionId,
    resultCode: record.resultCode,
    resultMessage: record.resultDescription,
    paymentBrand: record.paymentBrand,
    needsManualReview: false,
    mismatches,
    fromCache,
  };
}

/**
 * Ask AFS for the outcome of a checkout and turn it into our payment status.
 * This is the only thing that is allowed to decide SUCCESS.
 *
 * Idempotent in two ways:
 *   - a checkout we never created is refused outright, so nobody can point us
 *     at an arbitrary checkout belonging to someone else on the shared entity;
 *   - a payment that already settled is returned straight from the record
 *     without calling AFS again, so refreshes and duplicate callbacks are free
 *     and cannot change the outcome.
 */
export async function verifyPaymentByResourcePath(resourcePath: string): Promise<VerifiedPayment> {
  const config = getAfsConfig();
  const { checkoutId } = parseResourcePath(resourcePath);

  const known = getPaymentByCheckoutId(checkoutId);
  if (!known) {
    // Without our own record there is no authoritative amount to compare
    // against, so "verification" would be meaningless. Refuse rather than
    // fall back to a default amount.
    logPaymentError("afs.payment.unknown_checkout", { checkoutId });
    throw new AfsError("VERIFICATION", "No payment attempt is known for this checkout", {
      publicMessage: "This payment could not be found.",
      httpStatus: 404,
      details: { checkoutId },
    });
  }

  if (isTerminalPaymentStatus(known.status)) {
    logPayment("afs.payment.verify_skipped_settled", {
      checkoutId,
      orderId: known.orderId,
      status: known.status,
    });
    return toView(known, [], true);
  }

  const { data } = await afsRequest<AfsPaymentStatusResponse>(config, {
    // resourcePath is validated above and starts with "/v1/...".
    path: resourcePath,
    method: "GET",
    query: { entityId: config.entityId },
  });

  const outcome = verifyPayment(data, { amount: known.amount, currency: known.currency });

  const updated = updatePayment(checkoutId, {
    status: outcome.status,
    // Straight from the AFS payment response. Never generated, never from a URL.
    transactionId: data.id ?? null,
    resultCode: data.result?.code ?? null,
    resultDescription: data.result?.description ?? null,
    paymentBrand: data.paymentBrand ?? null,
    verifiedAt: new Date().toISOString(),
  });

  logPayment("afs.payment.verified", {
    checkoutId,
    orderId: known.orderId,
    transactionId: data.id,
    status: outcome.status,
    resultCode: data.result?.code,
    resultClass: outcome.resultClass,
    mismatches: outcome.mismatches,
  });

  const view = toView(updated ?? known, outcome.mismatches, false);
  view.needsManualReview = outcome.resultClass === "SUCCESS_REVIEW";
  return view;
}

/** Convenience wrapper for callers that only hold a checkout id. */
export function verifyPaymentByCheckoutId(checkoutId: string): Promise<VerifiedPayment> {
  return verifyPaymentByResourcePath(`/v1/checkouts/${checkoutId}/payment`);
}
