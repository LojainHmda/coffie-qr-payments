import { describe, expect, it } from "vitest";

import type { AfsPaymentStatusResponse } from "@/lib/payments/afs/types";
import {
  classifyResultCode,
  isCancelledCode,
  isCheckoutCreated,
  verifyPayment,
} from "@/lib/payments/afs/verification";
import { PaymentStatus } from "@/lib/payments/payment";

const EXPECTED = { amount: "5.00", currency: "AED" };

function statusResponse(overrides: Partial<AfsPaymentStatusResponse> = {}): AfsPaymentStatusResponse {
  return {
    id: "8ac7a4a1000",
    amount: "5.00",
    currency: "AED",
    paymentBrand: "VISA",
    result: { code: "000.100.110", description: "Request successfully processed in 'Merchant in Integrator Test Mode'" },
    ...overrides,
  };
}

describe("classifyResultCode", () => {
  it.each([
    ["000.000.000", "SUCCESS"],
    ["000.100.110", "SUCCESS"],
    ["000.300.000", "SUCCESS"],
    ["000.600.000", "SUCCESS"],
    ["000.400.110", "SUCCESS"],
  ])("treats %s as a successful payment", (code, expected) => {
    expect(classifyResultCode(code)).toBe(expected);
  });

  it("flags manual-review codes separately", () => {
    expect(classifyResultCode("000.400.000")).toBe("SUCCESS_REVIEW");
    expect(classifyResultCode("000.400.100")).toBe("SUCCESS_REVIEW");
  });

  it("treats 000.200.x as pending", () => {
    expect(classifyResultCode("000.200.100")).toBe("PENDING");
  });

  it.each(["100.396.101", "800.100.151", "200.300.404", undefined, null, ""])(
    "treats %s as failed",
    (code) => {
      expect(classifyResultCode(code)).toBe("FAILED");
    },
  );
});

describe("isCheckoutCreated / isCancelledCode", () => {
  it("recognises the checkout-created code", () => {
    expect(isCheckoutCreated("000.200.100")).toBe(true);
    expect(isCheckoutCreated("000.200.000")).toBe(false);
  });

  it("recognises shopper cancellation codes", () => {
    expect(isCancelledCode("100.396.101")).toBe(true);
    expect(isCancelledCode("100.397.101")).toBe(true);
    expect(isCancelledCode("800.100.151")).toBe(false);
  });
});

describe("verifyPayment", () => {
  it("returns SUCCESS for a matching successful payment", () => {
    const outcome = verifyPayment(statusResponse(), EXPECTED);
    expect(outcome.status).toBe(PaymentStatus.SUCCESS);
    expect(outcome.mismatches).toEqual([]);
  });

  it("downgrades a successful code to FAILED when the amount differs", () => {
    const outcome = verifyPayment(statusResponse({ amount: "0.01" }), EXPECTED);
    expect(outcome.status).toBe(PaymentStatus.FAILED);
    expect(outcome.mismatches.join()).toContain("amount");
  });

  it("downgrades a successful code to FAILED when the currency differs", () => {
    const outcome = verifyPayment(statusResponse({ currency: "USD" }), EXPECTED);
    expect(outcome.status).toBe(PaymentStatus.FAILED);
    expect(outcome.mismatches.join()).toContain("currency");
  });

  it("accepts an equivalent numeric amount formatting", () => {
    const outcome = verifyPayment(statusResponse({ amount: "5.0" }), EXPECTED);
    expect(outcome.status).toBe(PaymentStatus.SUCCESS);
  });

  it("maps a declined payment to FAILED", () => {
    const outcome = verifyPayment(
      statusResponse({ result: { code: "800.100.151", description: "invalid card" } }),
      EXPECTED,
    );
    expect(outcome.status).toBe(PaymentStatus.FAILED);
  });

  it("does not report an amount mismatch when AFS reports no payment at all", () => {
    const outcome = verifyPayment(
      {
        result: {
          code: "200.300.404",
          description: "invalid or missing parameter - no payment session found",
        },
      },
      EXPECTED,
    );
    expect(outcome.status).toBe(PaymentStatus.FAILED);
    expect(outcome.mismatches).toEqual([]);
  });

  it("maps a shopper cancellation to CANCELLED", () => {
    const outcome = verifyPayment(
      statusResponse({ result: { code: "100.396.101", description: "Cancelled by user" } }),
      EXPECTED,
    );
    expect(outcome.status).toBe(PaymentStatus.CANCELLED);
  });

  it("maps a still-pending checkout to PENDING", () => {
    const outcome = verifyPayment(
      statusResponse({ result: { code: "000.200.100", description: "created" } }),
      EXPECTED,
    );
    expect(outcome.status).toBe(PaymentStatus.PENDING);
  });

  it("marks manual-review results", () => {
    const outcome = verifyPayment(
      statusResponse({ result: { code: "000.400.000", description: "review" } }),
      EXPECTED,
    );
    expect(outcome.status).toBe(PaymentStatus.SUCCESS);
    expect(outcome.resultClass).toBe("SUCCESS_REVIEW");
  });
});
