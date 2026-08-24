import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMachines } from "@/lib/catalog/machines";
import {
  OrderError,
  createMachineOrder,
  startOrderPayment,
  verifyOrderPayment,
} from "@/lib/orders/checkout";
import { OrderStatus } from "@/lib/orders/order";
import { getOrder, listOrders, resetOrderStore } from "@/lib/orders/store";
import { PaymentMethod, PaymentStatus } from "@/lib/payments/payment";
import { getPaymentsByOrderId, resetPaymentStore } from "@/lib/payments/store";

/**
 * End-to-end behaviour of the QR flow with AFS mocked at the fetch boundary.
 *
 * These cover the scenarios in the brief: successful payment, failed payment,
 * refreshing the result page, duplicate verification, and the two tampering
 * attempts (price and machine).
 */

const [MACHINE_ONE, MACHINE_TWO] = listMachines();
const RESULT_URL = "http://192.168.1.45:3000/pay/token/result";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetOrderStore();
  resetPaymentStore();
  vi.stubEnv("AFS_ENTITY_ID", "entity-123");
  vi.stubEnv("AFS_ACCESS_TOKEN", "token-abc");
  vi.stubEnv("AFS_BASE_URL", "https://eu-test.oppwa.com/");
  vi.stubEnv("AFS_CURRENCY", "AED");
  vi.stubEnv("AFS_WALLET_METHODS", "");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockCheckoutCreated(checkoutId = "chk_1") {
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: checkoutId, result: { code: "000.200.100" } }));
}

function mockPaymentResult(result: { code: string; description?: string }, amount = "3.00") {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ id: "8ac7-afs-txn-1", amount, currency: "AED", paymentBrand: "VISA", result }),
  );
}

/** Walk the whole flow: order -> checkout -> AFS result -> verification. */
async function payForCoffee(resultCode: string, amountFromAfs = "3.00") {
  const order = createMachineOrder({
    machineToken: MACHINE_ONE.publicToken,
    productId: "prd_coffee",
  });

  mockCheckoutCreated();
  await startOrderPayment({
    machineToken: MACHINE_ONE.publicToken,
    orderId: order.id,
    method: PaymentMethod.CARD,
    shopperResultUrl: RESULT_URL,
  });

  mockPaymentResult({ code: resultCode, description: "test" }, amountFromAfs);
  const outcome = await verifyOrderPayment({
    machineToken: MACHINE_ONE.publicToken,
    resourcePath: "/v1/checkouts/chk_1/payment",
  });

  return { order, outcome };
}

describe("createMachineOrder", () => {
  it("prices the order from the catalogue, not the caller", () => {
    const order = createMachineOrder({
      machineToken: MACHINE_ONE.publicToken,
      productId: "prd_coffee",
    });

    expect(order.total).toBe("3.00");
    expect(order.currency).toBe("AED");
    expect(order.machineId).toBe(MACHINE_ONE.id);
    expect(order.items).toEqual([
      {
        productId: "prd_coffee",
        productName: "Coffee",
        quantity: 1,
        unitPrice: "3.00",
        totalPrice: "3.00",
      },
    ]);
  });

  it("rejects an unknown machine token", () => {
    expect(() =>
      createMachineOrder({ machineToken: "notarealtokenatall00", productId: "prd_coffee" }),
    ).toThrowError(OrderError);
  });

  it("rejects an inactive product", () => {
    expect(() =>
      createMachineOrder({
        machineToken: MACHINE_ONE.publicToken,
        productId: "prd_hot_chocolate",
      }),
    ).toThrowError(OrderError);
  });
});

describe("startOrderPayment", () => {
  it("sends the order total to AFS, whatever the browser thinks the price is", async () => {
    const order = createMachineOrder({
      machineToken: MACHINE_ONE.publicToken,
      productId: "prd_coffee",
    });
    mockCheckoutCreated();

    await startOrderPayment({
      machineToken: MACHINE_ONE.publicToken,
      orderId: order.id,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    });

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("amount")).toBe("3.00");
    expect(body.get("currency")).toBe("AED");
    expect(getOrder(order.id)?.status).toBe(OrderStatus.AWAITING_PAYMENT);
  });

  it("refuses to attach an order to a different machine", async () => {
    const order = createMachineOrder({
      machineToken: MACHINE_ONE.publicToken,
      productId: "prd_coffee",
    });

    const error = await startOrderPayment({
      // The customer swapped in machine two's token.
      machineToken: MACHINE_TWO.publicToken,
      orderId: order.id,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getOrder(order.id)?.machineId).toBe(MACHINE_ONE.id);
  });

  it("refuses a payment method the merchant has not enabled", async () => {
    const order = createMachineOrder({
      machineToken: MACHINE_ONE.publicToken,
      productId: "prd_coffee",
    });

    const error = await startOrderPayment({
      machineToken: MACHINE_ONE.publicToken,
      orderId: order.id,
      method: PaymentMethod.APPLE_PAY,
      shopperResultUrl: RESULT_URL,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("verifyOrderPayment", () => {
  it("marks the order PAID and stores the AFS transaction id", async () => {
    const { order, outcome } = await payForCoffee("000.100.110");

    expect(outcome.payment.status).toBe(PaymentStatus.SUCCESS);
    expect(outcome.payment.transactionId).toBe("8ac7-afs-txn-1");
    expect(outcome.order.status).toBe(OrderStatus.PAID);
    expect(getOrder(order.id)?.paidAt).not.toBeNull();
  });

  it("leaves the order unpaid when AFS declines", async () => {
    const { order, outcome } = await payForCoffee("800.100.151");

    expect(outcome.payment.status).toBe(PaymentStatus.FAILED);
    expect(getOrder(order.id)?.status).toBe(OrderStatus.FAILED);
    expect(getOrder(order.id)?.paidAt).toBeNull();
  });

  it("fails a payment whose amount does not match the order", async () => {
    // AFS reports 0.01 for an order the server priced at 3.00.
    const { order, outcome } = await payForCoffee("000.100.110", "0.01");

    expect(outcome.payment.status).toBe(PaymentStatus.FAILED);
    expect(outcome.payment.mismatches.join()).toContain("amount");
    expect(getOrder(order.id)?.status).not.toBe(OrderStatus.PAID);
  });

  it("survives a refreshed result page without duplicating anything", async () => {
    const { order } = await payForCoffee("000.100.110");
    const callsAfterFirstVerify = fetchMock.mock.calls.length;

    // Three more reloads of /pay/{token}/result?resourcePath=...
    for (let i = 0; i < 3; i++) {
      const repeat = await verifyOrderPayment({
        machineToken: MACHINE_ONE.publicToken,
        resourcePath: "/v1/checkouts/chk_1/payment",
      });
      expect(repeat.payment.status).toBe(PaymentStatus.SUCCESS);
      expect(repeat.order.status).toBe(OrderStatus.PAID);
    }

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstVerify);
    expect(listOrders()).toHaveLength(1);
    expect(getPaymentsByOrderId(order.id)).toHaveLength(1);
  });

  it("refuses to verify a payment through another machine's token", async () => {
    await payForCoffee("000.100.110");

    const error = await verifyOrderPayment({
      machineToken: MACHINE_TWO.publicToken,
      resourcePath: "/v1/checkouts/chk_1/payment",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(403);
  });

  it("refuses a checkout that belongs to no order of ours", async () => {
    const error = await verifyOrderPayment({
      machineToken: MACHINE_ONE.publicToken,
      resourcePath: "/v1/checkouts/someone_elses/payment",
    }).catch((e) => e);

    expect(error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("will not start a second payment for an order already paid", async () => {
    const { order } = await payForCoffee("000.100.110");

    const error = await startOrderPayment({
      machineToken: MACHINE_ONE.publicToken,
      orderId: order.id,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(409);
  });
});
