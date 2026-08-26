import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listMachines } from "@/lib/catalog/machines";
import {
  OrderError,
  createMachineOrder,
  machineOrderView,
  resolveScannedOrder,
  startOrderPayment,
  verifyOrderPayment,
} from "@/lib/orders/checkout";
import { OrderStatus } from "@/lib/orders/order";
import { getOrder, getOrderByPayToken, listOrders, resetOrderStore } from "@/lib/orders/store";
import { PaymentMethod, PaymentStatus } from "@/lib/payments/payment";
import { getPaymentsByOrderId, resetPaymentStore } from "@/lib/payments/store";

/**
 * End-to-end behaviour of the machine-first flow, with AFS mocked at the fetch
 * boundary.
 *
 * The model these tests pin down:
 *
 *   the machine  builds the order (authenticated as itself, prices from us)
 *   the QR       carries one order's pay token and nothing else
 *   the phone    can only pay that order — it names no machine, no product,
 *                no price, and cannot reach any other order
 *
 * Plus the scenarios from the brief: success, failure, refreshed result page,
 * duplicate verification, and the tampering attempts.
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
  vi.stubEnv("ORDER_PAY_WINDOW_MINUTES", "15");
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function mockCheckoutCreated(checkoutId = "chk_1") {
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: checkoutId, result: { code: "000.200.100" } }));
}

function mockPaymentResult(result: { code: string; description?: string }, amount = "3.00") {
  fetchMock.mockResolvedValueOnce(
    jsonResponse({ id: "8ac7-afs-txn-1", amount, currency: "AED", paymentBrand: "VISA", result }),
  );
}

function orderOneCoffee(machine = MACHINE_ONE) {
  return createMachineOrder({ machine, lines: [{ productId: "prd_coffee", quantity: 1 }] });
}

/** Walk the whole flow: machine order -> scanned QR -> AFS result -> settled. */
async function payForCoffee(resultCode: string, amountFromAfs = "3.00") {
  const order = orderOneCoffee();

  mockCheckoutCreated();
  await startOrderPayment({
    payToken: order.payToken,
    method: PaymentMethod.CARD,
    shopperResultUrl: RESULT_URL,
  });

  mockPaymentResult({ code: resultCode, description: "test" }, amountFromAfs);
  const outcome = await verifyOrderPayment({
    payToken: order.payToken,
    resourcePath: "/v1/checkouts/chk_1/payment",
  });

  return { order, outcome };
}

describe("createMachineOrder", () => {
  it("prices the order from the catalogue, not the machine", () => {
    const order = orderOneCoffee();

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

  it("totals a multi-drink basket in minor units", () => {
    const order = createMachineOrder({
      machine: MACHINE_ONE,
      lines: [
        { productId: "prd_coffee", quantity: 3 },
        { productId: "prd_cappuccino", quantity: 2 },
      ],
    });

    // 3 x 3.00 + 2 x 6.00
    expect(order.total).toBe("21.00");
    expect(order.items.map((item) => item.totalPrice)).toEqual(["9.00", "12.00"]);
  });

  it("merges repeated taps on the same drink into one line", () => {
    const order = createMachineOrder({
      machine: MACHINE_ONE,
      lines: [
        { productId: "prd_coffee", quantity: 1 },
        { productId: "prd_coffee", quantity: 2 },
      ],
    });

    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(3);
    expect(order.total).toBe("9.00");
  });

  it("gives each order its own unguessable pay token", () => {
    const first = orderOneCoffee();
    const second = orderOneCoffee();

    expect(first.payToken).not.toBe(second.payToken);
    expect(first.payToken.length).toBeGreaterThanOrEqual(22);
    // The token must not leak the order it belongs to.
    expect(first.payToken).not.toContain(first.id);
  });

  it("rejects an inactive product", () => {
    expect(() =>
      createMachineOrder({
        machine: MACHINE_ONE,
        lines: [{ productId: "prd_hot_chocolate", quantity: 1 }],
      }),
    ).toThrowError(OrderError);
  });

  it("rejects an empty basket", () => {
    expect(() => createMachineOrder({ machine: MACHINE_ONE, lines: [] })).toThrowError(OrderError);
  });
});

describe("resolveScannedOrder", () => {
  it("resolves a scanned token to its order and machine", () => {
    const order = orderOneCoffee(MACHINE_TWO);
    const scanned = resolveScannedOrder(order.payToken);

    expect(scanned.order.id).toBe(order.id);
    expect(scanned.machine.id).toBe(MACHINE_TWO.id);
  });

  it("refuses an unknown token", () => {
    const error = (() => {
      try {
        resolveScannedOrder("nottherealtokenatall000");
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(404);
  });
});

describe("startOrderPayment", () => {
  it("sends the order total to AFS, whatever anyone else thinks the price is", async () => {
    const order = orderOneCoffee();
    mockCheckoutCreated();

    await startOrderPayment({
      payToken: order.payToken,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    });

    const body = new URLSearchParams(fetchMock.mock.calls[0][1].body as string);
    expect(body.get("amount")).toBe("3.00");
    expect(body.get("currency")).toBe("AED");
    expect(getOrder(order.id)?.status).toBe(OrderStatus.AWAITING_PAYMENT);
  });

  it("cannot be pointed at another order by swapping the token", async () => {
    const mine = orderOneCoffee(MACHINE_ONE);
    const theirs = createMachineOrder({
      machine: MACHINE_TWO,
      lines: [{ productId: "prd_cappuccino", quantity: 1 }],
    });

    mockCheckoutCreated();
    const { order } = await startOrderPayment({
      payToken: theirs.payToken,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    });

    // A different token is simply a different order, priced its own way. There
    // is no field left in which to smuggle someone else's order id.
    expect(order.id).toBe(theirs.id);
    expect(order.total).toBe("6.00");
    expect(getOrder(mine.id)?.status).toBe(OrderStatus.CREATED);
  });

  it("refuses a payment method the merchant has not enabled", async () => {
    const order = orderOneCoffee();

    const error = await startOrderPayment({
      payToken: order.payToken,
      method: PaymentMethod.APPLE_PAY,
      shopperResultUrl: RESULT_URL,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a code whose pay window has closed", async () => {
    vi.useFakeTimers();
    const order = orderOneCoffee();

    // A photographed QR, sixteen minutes later.
    vi.advanceTimersByTime(16 * 60_000);

    const error = await startOrderPayment({
      payToken: order.payToken,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(410);
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

    // Three more reloads of /pay/{payToken}/result?resourcePath=...
    for (let i = 0; i < 3; i++) {
      const repeat = await verifyOrderPayment({
        payToken: order.payToken,
        resourcePath: "/v1/checkouts/chk_1/payment",
      });
      expect(repeat.payment.status).toBe(PaymentStatus.SUCCESS);
      expect(repeat.order.status).toBe(OrderStatus.PAID);
    }

    expect(fetchMock.mock.calls.length).toBe(callsAfterFirstVerify);
    expect(listOrders()).toHaveLength(1);
    expect(getPaymentsByOrderId(order.id)).toHaveLength(1);
  });

  it("refuses to settle one order with another order's checkout", async () => {
    // A customer holding their own valid token points the result page at
    // somebody else's AFS checkout.
    const { order: victim } = await payForCoffee("000.100.110");
    const attacker = orderOneCoffee();

    const error = await verifyOrderPayment({
      payToken: attacker.payToken,
      resourcePath: "/v1/checkouts/chk_1/payment",
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(403);
    expect(getOrder(attacker.id)?.status).toBe(OrderStatus.CREATED);
    expect(getOrder(victim.id)?.status).toBe(OrderStatus.PAID);
  });

  it("refuses a checkout that belongs to no order of ours", async () => {
    const order = orderOneCoffee();

    const error = await verifyOrderPayment({
      payToken: order.payToken,
      resourcePath: "/v1/checkouts/someone_elses/payment",
    }).catch((e) => e);

    expect(error).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still settles a payment that returns after the pay window closed", async () => {
    // The customer started paying in time but came back from a 3-D Secure
    // challenge late. Refusing here would take the money and pour nothing.
    vi.useFakeTimers();
    const order = orderOneCoffee();

    mockCheckoutCreated();
    await startOrderPayment({
      payToken: order.payToken,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    });

    vi.advanceTimersByTime(20 * 60_000);

    mockPaymentResult({ code: "000.100.110" });
    const outcome = await verifyOrderPayment({
      payToken: order.payToken,
      resourcePath: "/v1/checkouts/chk_1/payment",
    });

    expect(outcome.order.status).toBe(OrderStatus.PAID);
  });

  it("will not start a second payment for an order already paid", async () => {
    const { order } = await payForCoffee("000.100.110");

    const error = await startOrderPayment({
      payToken: order.payToken,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    }).catch((e) => e);

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(409);
  });
});

describe("machineOrderView", () => {
  it("tells the machine to dispense only after a verified payment", async () => {
    const order = orderOneCoffee();

    expect(machineOrderView(MACHINE_ONE, order.id).dispense).toBe(false);

    mockCheckoutCreated();
    await startOrderPayment({
      payToken: order.payToken,
      method: PaymentMethod.CARD,
      shopperResultUrl: RESULT_URL,
    });
    // A checkout exists and the customer is at the payment page. Still no drink.
    expect(machineOrderView(MACHINE_ONE, order.id).dispense).toBe(false);

    mockPaymentResult({ code: "000.100.110" });
    await verifyOrderPayment({
      payToken: order.payToken,
      resourcePath: "/v1/checkouts/chk_1/payment",
    });

    const view = machineOrderView(MACHINE_ONE, order.id);
    expect(view.status).toBe(OrderStatus.PAID);
    expect(view.dispense).toBe(true);
  });

  it("does not tell the machine to dispense on a declined payment", async () => {
    const { order } = await payForCoffee("800.100.151");

    expect(machineOrderView(MACHINE_ONE, order.id).dispense).toBe(false);
  });

  it("refuses to read another machine's order", () => {
    const order = orderOneCoffee(MACHINE_ONE);

    const error = (() => {
      try {
        machineOrderView(MACHINE_TWO, order.id);
      } catch (e) {
        return e;
      }
    })();

    expect(error).toBeInstanceOf(OrderError);
    expect((error as OrderError).httpStatus).toBe(403);
  });

  it("never hands the machine the pay token back", () => {
    const order = orderOneCoffee();
    const view = machineOrderView(MACHINE_ONE, order.id);

    // Anyone reading the machine's screen could otherwise pay for, and take,
    // this drink.
    expect(JSON.stringify(view)).not.toContain(order.payToken);
    expect(getOrderByPayToken(order.payToken)?.id).toBe(order.id);
  });
});
