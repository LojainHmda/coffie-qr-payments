import { PaymentStatus } from "../payment";
import { AFS_CHECKOUT_CREATED_CODE, AFS_RESULT_PATTERNS } from "./constants";
import type { AfsPaymentStatusResponse } from "./types";

/**
 * Server-side interpretation of an AFS result. A browser redirect is never
 * treated as proof of payment — only the result of GET .../payment is.
 */

export type AfsResultClass = "SUCCESS" | "SUCCESS_REVIEW" | "PENDING" | "FAILED";

/**
 * Classify an AFS result code using the patterns published at
 * https://afs.docs.oppwa.com/reference/resultCodes
 */
export function classifyResultCode(code: string | undefined | null): AfsResultClass {
  if (!code) return "FAILED";
  if (AFS_RESULT_PATTERNS.success.test(code)) return "SUCCESS";
  if (AFS_RESULT_PATTERNS.successNeedsReview.test(code)) return "SUCCESS_REVIEW";
  if (AFS_RESULT_PATTERNS.pending.test(code)) return "PENDING";
  return "FAILED";
}

/** "000.200.100" — the checkout was created and is awaiting shopper action. */
export function isCheckoutCreated(code: string | undefined | null): boolean {
  return code === AFS_CHECKOUT_CREATED_CODE;
}

/**
 * Asynchronous-workflow codes that mean the shopper walked away rather than
 * the payment being declined: 100.396.101/102/103/104, 100.397.101.
 */
const CANCELLED_CODES = new Set([
  "100.396.101",
  "100.396.102",
  "100.396.103",
  "100.396.104",
  "100.397.101",
]);

export function isCancelledCode(code: string | undefined | null): boolean {
  return code ? CANCELLED_CODES.has(code) : false;
}

export interface ExpectedPayment {
  amount: string;
  currency: string;
}

export interface VerificationOutcome {
  status: PaymentStatus;
  resultClass: AfsResultClass;
  /** Non-empty when AFS reports an amount/currency we did not ask for. */
  mismatches: string[];
}

function amountsEqual(a: string | undefined, b: string): boolean {
  if (!a) return false;
  const left = Number.parseFloat(a);
  const right = Number.parseFloat(b);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < 0.005;
}

/**
 * Decide the internal payment status from an AFS payment-status response.
 * A "successful" result code is downgraded to FAILED when the amount or
 * currency does not match what the server asked AFS to charge.
 */
export function verifyPayment(
  response: AfsPaymentStatusResponse,
  expected: ExpectedPayment,
): VerificationOutcome {
  const code = response.result?.code;
  const resultClass = classifyResultCode(code);
  const succeeded = resultClass === "SUCCESS" || resultClass === "SUCCESS_REVIEW";
  const mismatches: string[] = [];

  // Only meaningful when AFS actually reports a payment. On a gateway error
  // (no payment session, bad parameter, ...) there is no amount to compare and
  // reporting a "mismatch" would hide the real failure.
  if (succeeded) {
    if (!amountsEqual(response.amount, expected.amount)) {
      mismatches.push(
        `amount: expected ${expected.amount}, AFS reported ${response.amount ?? "none"}`,
      );
    }
    if (response.currency !== expected.currency) {
      mismatches.push(
        `currency: expected ${expected.currency}, AFS reported ${response.currency ?? "none"}`,
      );
    }
  }

  let status: PaymentStatus;
  if (succeeded) {
    status = mismatches.length > 0 ? PaymentStatus.FAILED : PaymentStatus.SUCCESS;
  } else if (resultClass === "PENDING") {
    status = PaymentStatus.PENDING;
  } else if (isCancelledCode(code)) {
    status = PaymentStatus.CANCELLED;
  } else {
    status = PaymentStatus.FAILED;
  }

  return { status, resultClass, mismatches };
}
