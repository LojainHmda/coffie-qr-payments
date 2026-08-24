import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AfsError } from "@/lib/payments/afs/errors";
import {
  parseResourcePath,
  prepareTestCheckout,
  verifyPaymentByResourcePath,
} from "@/lib/payments/afs/service";
import { PaymentStatus } from "@/lib/payments/payment";
import { getPaymentByCheckoutId, resetPaymentStore } from "@/lib/payments/store";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetPaymentStore();
  vi.stubEnv("AFS_ENTITY_ID", "entity-123");
  vi.stubEnv("AFS_ACCESS_TOKEN", "token-abc");
  vi.stubEnv("AFS_BASE_URL", "https://eu-test.oppwa.com/");
  vi.stubEnv("AFS_CURRENCY", "AED");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Keep the sanitised JSON logs out of the test output.
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prepareTestCheckout", () => {
  it("sends the server-owned amount and returns only safe data", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        id: "chk_abc",
        integrity: "sha384-xyz",
        result: { code: "000.200.100", description: "successfully created checkout" },
      }),
    );

    const checkout = await prepareTestCheckout({
      shopperResultUrl: "http://localhost:3000/payment-test/result",
    });

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("amount")).toBe("5.00");
    expect(body.get("currency")).toBe("AED");
    expect(body.get("paymentType")).toBe("DB");
    expect(body.get("entityId")).toBe("entity-123");
    // Must NOT be on the checkout: the Copy&Pay widget sends it from the form
    // action, and AFS rejects the payment if the checkout already set it.
    expect(body.has("shopperResultUrl")).toBe(false);
    expect(body.get("merchantTransactionId")?.length).toBeGreaterThanOrEqual(8);

    expect(checkout.checkoutId).toBe("chk_abc");
    expect(checkout.amount).toBe("5.00");
    expect(checkout.widgetScriptUrl).toBe(
      "https://eu-test.oppwa.com/v1/paymentWidgets.js?checkoutId=chk_abc",
    );
    expect(JSON.stringify(checkout)).not.toContain("token-abc");
  });

  it("includes the customer and billing data 3-D Secure 2 needs", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chk_abc", result: { code: "000.200.100" } }));
    await prepareTestCheckout({
      shopperResultUrl: "http://localhost:3000/payment-test/result",
      customerIp: "203.0.113.7",
    });

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("customer.email")).toBeTruthy();
    expect(body.get("billing.city")).toBe("Dubai");
    expect(body.get("billing.country")).toBe("AE");
    expect(body.get("customer.ip")).toBe("203.0.113.7");
  });

  it("omits customer.ip when no usable address is available", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chk_abc", result: { code: "000.200.100" } }));
    await prepareTestCheckout({
      shopperResultUrl: "http://localhost:3000/payment-test/result",
      customerIp: null,
    });

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.has("customer.ip")).toBe(false);
  });

  it("records the payment as PENDING", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "chk_abc", result: { code: "000.200.100" } }));
    await prepareTestCheckout({ shopperResultUrl: "http://localhost:3000/payment-test/result" });
    expect(getPaymentByCheckoutId("chk_abc")?.status).toBe(PaymentStatus.PENDING);
  });

  it("throws when AFS rejects the checkout", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        result: { code: "200.300.404", description: "invalid or missing parameter" },
      }),
    );
    const error = await prepareTestCheckout({ shopperResultUrl: "http://x/y" }).catch((e) => e);
    expect(error).toBeInstanceOf(AfsError);
    expect((error as AfsError).kind).toBe("AFS_REJECTED");
  });

  it("throws when the configuration is missing", async () => {
    vi.stubEnv("AFS_ACCESS_TOKEN", "");
    const error = await prepareTestCheckout({ shopperResultUrl: "http://x/y" }).catch((e) => e);
    expect((error as AfsError).kind).toBe("CONFIG");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("parseResourcePath", () => {
  it("extracts the checkout id", () => {
    expect(parseResourcePath("/v1/checkouts/chk_abc/payment")).toEqual({ checkoutId: "chk_abc" });
  });

  it.each([
    "/v1/checkouts/../../admin/payment",
    "https://evil.example/v1/checkouts/x/payment",
    "/v1/checkouts/chk/refund",
    "",
  ])("rejects %s", (path) => {
    expect(() => parseResourcePath(path)).toThrowError(AfsError);
  });
});

describe("verifyPaymentByResourcePath", () => {
  /** Every verification needs one of our own checkouts to compare against. */
  async function withPreparedCheckout() {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ id: "chk_abc", result: { code: "000.200.100" } }),
    );
    await prepareTestCheckout({ shopperResultUrl: "http://localhost:3000/payment-test/result" });
  }

  it("confirms a successful payment against AFS", async () => {
    await withPreparedCheckout();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "8ac7a4a1txn",
        amount: "5.00",
        currency: "AED",
        paymentBrand: "VISA",
        result: { code: "000.100.110", description: "Request successfully processed" },
      }),
    );

    const result = await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");

    const [url] = fetchMock.mock.calls[1];
    expect(url).toBe("https://eu-test.oppwa.com/v1/checkouts/chk_abc/payment?entityId=entity-123");
    expect(result.status).toBe(PaymentStatus.SUCCESS);
    expect(result.transactionId).toBe("8ac7a4a1txn");
    expect(result.resultCode).toBe("000.100.110");
  });

  it("reports a declined payment as FAILED", async () => {
    await withPreparedCheckout();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "8ac7a4a1txn",
        amount: "5.00",
        currency: "AED",
        result: { code: "800.100.151", description: "transaction declined (invalid card)" },
      }),
    );
    const result = await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");
    expect(result.status).toBe(PaymentStatus.FAILED);
    expect(result.resultMessage).toContain("declined");
  });

  it("refuses a checkout we never created instead of assuming an amount", async () => {
    const error = await verifyPaymentByResourcePath("/v1/checkouts/not_ours/payment").catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(AfsError);
    expect((error as AfsError).httpStatus).toBe(404);
    // Nothing was asked of AFS: we refused before making the call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the settled payment without calling AFS again", async () => {
    await withPreparedCheckout();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: "txn-1",
        amount: "5.00",
        currency: "AED",
        result: { code: "000.100.110" },
      }),
    );
    const first = await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");
    expect(first.status).toBe(PaymentStatus.SUCCESS);
    expect(first.fromCache).toBe(false);

    const callsAfterFirst = fetchMock.mock.calls.length;
    const second = await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");

    expect(second.status).toBe(PaymentStatus.SUCCESS);
    expect(second.transactionId).toBe("txn-1");
    expect(second.fromCache).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it("cannot be talked out of a success by a later failure response", async () => {
    await withPreparedCheckout();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ id: "txn-1", amount: "5.00", currency: "AED", result: { code: "000.100.110" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: "txn-1", amount: "5.00", currency: "AED", result: { code: "800.100.151" } }),
      );

    await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");
    const replay = await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");

    expect(replay.status).toBe(PaymentStatus.SUCCESS);
    expect(getPaymentByCheckoutId("chk_abc")?.status).toBe(PaymentStatus.SUCCESS);
  });

  it("fails a payment whose amount does not match the checkout we created", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "chk_abc", result: { code: "000.200.100" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "txn",
          amount: "0.01",
          currency: "AED",
          result: { code: "000.100.110" },
        }),
      );

    await prepareTestCheckout({ shopperResultUrl: "http://localhost:3000/payment-test/result" });
    const result = await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");

    expect(result.status).toBe(PaymentStatus.FAILED);
    expect(result.mismatches.join()).toContain("amount");
  });

  it("updates the stored payment record", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ id: "chk_abc", result: { code: "000.200.100" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "txn-1",
          amount: "5.00",
          currency: "AED",
          result: { code: "000.100.110" },
        }),
      );

    await prepareTestCheckout({ shopperResultUrl: "http://localhost:3000/payment-test/result" });
    await verifyPaymentByResourcePath("/v1/checkouts/chk_abc/payment");

    const record = getPaymentByCheckoutId("chk_abc");
    expect(record?.status).toBe(PaymentStatus.SUCCESS);
    expect(record?.transactionId).toBe("txn-1");
  });
});
