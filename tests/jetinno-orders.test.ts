import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseJetinnoConfig } from "@/lib/jetinno/config";
import { notifyPaymentResult, payStatusFor } from "@/lib/jetinno/notify";
import {
  JetinnoError,
  createJetinnoOrder,
  qrCodeForOrder,
  recordFulfilment,
  resolveMachineId,
} from "@/lib/jetinno/orders";
import { JetinnoCode, JetinnoPayStatus, QR_CODE_MAX_LENGTH } from "@/lib/jetinno/protocol";
import { signFields } from "@/lib/jetinno/signature";
import { jetinnoErrorResponse, jetinnoResponse, verifyInbound } from "@/lib/jetinno/transport";
import { GetQrCodeDataSchema, ProductDoneDataSchema } from "@/lib/jetinno/validation";
import { listMachines } from "@/lib/catalog/machines";
import { FulfilmentState, OrderSource, OrderStatus } from "@/lib/orders/order";
import { resetOrderStore, setOrderStatus } from "@/lib/orders/store";

/**
 * The Jetinno protocol inverts this app's usual rule: their machine prices the
 * basket and states the amount. These tests pin down what we do about that —
 * the signature is the authentication, the bound is the sanity check, and the
 * machine's order number is what keeps a retry from becoming a second sale.
 */

const ENV = {
  JETINNO_USERNAME: "testname",
  JETINNO_APIKEY: "DBRW17YE7FHKR72T",
  JETINNO_MERCHANT_NO: "M-100",
  JETINNO_MAX_ORDER_MINOR: "5000",
  JETINNO_DEVICE_MAP: `44401:${listMachines()[0].code}`,
};

const CONFIG = parseJetinnoConfig(ENV);

function qrRequest(overrides: Record<string, unknown> = {}) {
  return {
    deviceNo: "44401",
    merchantNo: "M-100",
    productId: "1",
    productName: "拿铁",
    orderNo: "201701041632542085957405",
    orderAmount: "600",
    notifyUrl: "https://machine.example.com/callback",
    payType: "1001",
    ...overrides,
  };
}

/** Wrap business data in a correctly signed envelope, the way a machine would. */
function envelope(data: Record<string, unknown>, options: { exclude?: string[] } = {}) {
  const time = "20210203163138";
  const fields = { username: ENV.JETINNO_USERNAME, time, ...data };
  return {
    username: ENV.JETINNO_USERNAME,
    time,
    sign: signFields(fields, ENV.JETINNO_APIKEY, { exclude: options.exclude ?? ["payType"] }),
    data,
  };
}

beforeEach(() => {
  resetOrderStore();
  process.env.APP_BASE_URL = "https://coffee.example.com";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.APP_BASE_URL;
});

describe("getQrCode — creating an order the machine priced", () => {
  it("takes the amount the machine stated, in cents", () => {
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest({ orderAmount: "600" })),
      currency: "AED",
    });

    expect(order.total).toBe("6.00");
    expect(order.currency).toBe("AED");
    expect(order.source).toBe(OrderSource.JETINNO);
  });

  it("accepts an amount that arrives as a JSON number", () => {
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest({ orderAmount: 350 })),
      currency: "AED",
    });

    expect(order.total).toBe("3.50");
  });

  it("keeps their product id and name rather than looking ours up", () => {
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest({ productId: "7", productName: "美式" })),
      currency: "AED",
    });

    expect(order.items).toHaveLength(1);
    expect(order.items[0].productId).toBe("7");
    expect(order.items[0].productName).toBe("美式");
  });

  it("records the callback address the machine supplied", () => {
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest()),
      currency: "AED",
    });

    expect(order.external?.notifyUrl).toBe("https://machine.example.com/callback");
    expect(order.external?.orderNo).toBe("201701041632542085957405");
    expect(order.external?.deviceNo).toBe("44401");
  });

  it("refuses an amount beyond JETINNO_MAX_ORDER_MINOR", () => {
    expect(() =>
      createJetinnoOrder({
        config: CONFIG,
        data: GetQrCodeDataSchema.parse(qrRequest({ orderAmount: "999999" })),
        currency: "AED",
      }),
    ).toThrow(JetinnoError);
  });

  it("refuses a zero amount", () => {
    expect(() =>
      createJetinnoOrder({
        config: CONFIG,
        data: GetQrCodeDataSchema.parse(qrRequest({ orderAmount: "0" })),
        currency: "AED",
      }),
    ).toThrow(/positive/);
  });

  it("refuses a merchantNo that is not ours", () => {
    expect(() =>
      createJetinnoOrder({
        config: CONFIG,
        data: GetQrCodeDataSchema.parse(qrRequest({ merchantNo: "SOMEONE-ELSE" })),
        currency: "AED",
      }),
    ).toThrow(/merchantNo/);
  });
});

describe("getQrCode — retries", () => {
  /**
   * §2.1 gives us 8 seconds before the machine gives up and asks again. A
   * retry has to land on the same order, or two of our orders sit behind one
   * cup and the customer can pay the wrong one.
   */
  it("returns the same order for a repeated orderNo", () => {
    const data = GetQrCodeDataSchema.parse(qrRequest());

    const first = createJetinnoOrder({ config: CONFIG, data, currency: "AED" });
    const second = createJetinnoOrder({ config: CONFIG, data, currency: "AED" });

    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(second.order.payToken).toBe(first.order.payToken);
  });

  it("treats a different orderNo as a different order", () => {
    const first = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest({ orderNo: "AAA1" })),
      currency: "AED",
    });
    const second = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest({ orderNo: "BBB2" })),
      currency: "AED",
    });

    expect(second.order.id).not.toBe(first.order.id);
  });

  it("refuses to re-serve an order that has already been paid", () => {
    const data = GetQrCodeDataSchema.parse(qrRequest());
    const { order } = createJetinnoOrder({ config: CONFIG, data, currency: "AED" });
    setOrderStatus(order.id, OrderStatus.PAID);

    expect(() => createJetinnoOrder({ config: CONFIG, data, currency: "AED" })).toThrow(
      /already been paid/,
    );
  });
});

describe("the qrCode string", () => {
  it("is this order's pay URL and fits the 128-character field", async () => {
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest()),
      currency: "AED",
    });

    const qrCode = await qrCodeForOrder(order);

    expect(qrCode).toBe(`https://coffee.example.com/pay/${order.payToken}`);
    expect(qrCode.length).toBeLessThanOrEqual(QR_CODE_MAX_LENGTH);
  });

  it("refuses rather than truncating when the base URL is too long to fit", async () => {
    process.env.APP_BASE_URL = `https://${"a".repeat(120)}.example.com`;
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest()),
      currency: "AED",
    });

    await expect(qrCodeForOrder(order)).rejects.toThrow(/128/);
  });
});

describe("device mapping", () => {
  it("maps a configured device number onto our machine", () => {
    expect(resolveMachineId(CONFIG, "44401")).toBe(listMachines()[0].id);
  });

  it("still trades for an unmapped device, under a traceable id", () => {
    expect(resolveMachineId(CONFIG, "99999")).toBe("jetinno:99999");
  });
});

describe("productdone — did coffee actually come out", () => {
  function paidOrder() {
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest()),
      currency: "AED",
    });
    return setOrderStatus(order.id, OrderStatus.PAID)!;
  }

  it("records a successful pour", () => {
    paidOrder();
    const updated = recordFulfilment({
      deviceNo: "44401",
      productId: "1",
      orderNo: "201701041632542085957405",
      isFinish: "SUCCESS",
    });

    expect(updated.fulfilment).toBe(FulfilmentState.SUCCESS);
  });

  /** Paid but not poured: the money moved and the drink did not. */
  it("records a failed pour without un-paying the order", () => {
    paidOrder();
    const updated = recordFulfilment({
      deviceNo: "44401",
      productId: "1",
      orderNo: "201701041632542085957405",
      isFinish: "ERROR",
    });

    expect(updated.fulfilment).toBe(FulfilmentState.ERROR);
    expect(updated.status).toBe(OrderStatus.PAID);
  });

  it("rejects a report for an order we never issued", () => {
    expect(() =>
      recordFulfilment({
        deviceNo: "44401",
        productId: "1",
        orderNo: "NOSUCHORDER",
        isFinish: "SUCCESS",
      }),
    ).toThrow(/No order matches/);
  });
});

describe("inbound envelope verification", () => {
  it("accepts a correctly signed request", () => {
    const verified = verifyInbound(envelope(qrRequest()), GetQrCodeDataSchema, {
      excludeFromSignature: ["payType"],
      env: ENV,
    });

    expect(verified.data.orderNo).toBe("201701041632542085957405");
  });

  it("rejects a tampered amount", () => {
    const message = envelope(qrRequest());
    message.data.orderAmount = "1";

    expect(() => verifyInbound(message, GetQrCodeDataSchema, { env: ENV })).toThrow(
      /Signature does not verify/,
    );
  });

  it("rejects an unknown username before looking at the signature", () => {
    const message = { ...envelope(qrRequest()), username: "someone-else" };

    expect(() => verifyInbound(message, GetQrCodeDataSchema, { env: ENV })).toThrow(/Unknown username/);
  });

  it("rejects a message with no signature at all", () => {
    const message = { ...envelope(qrRequest()), sign: "" };

    expect(() => verifyInbound(message, GetQrCodeDataSchema, { env: ENV })).toThrow(/envelope/);
  });

  /**
   * §2.4: "the added extended fields must be supported when verifying the
   * signature". A field we have never heard of must survive into the signature
   * base, or every message that carries one fails.
   */
  it("carries unknown extension fields into the signature", () => {
    const data = qrRequest({ someFutureField: "v2" });
    const verified = verifyInbound(envelope(data), GetQrCodeDataSchema, {
      excludeFromSignature: ["payType"],
      env: ENV,
    });

    expect(verified.data.orderNo).toBe("201701041632542085957405");
  });

  /**
   * §2.4 rule 6: optional fields do not participate. merchantNo is optional in
   * §3.1.2, so a spec-following sender leaves it out of the signature.
   */
  it("accepts a request that leaves optional merchantNo out of the signature", () => {
    const verified = verifyInbound(
      envelope(qrRequest(), { exclude: ["payType", "merchantNo"] }),
      GetQrCodeDataSchema,
      { excludeFromSignature: ["payType"], env: ENV },
    );

    expect(verified.data.merchantNo).toBe("M-100");
  });

  it("accepts a productdone that leaves optional platBillNo out of the signature", () => {
    const data = {
      deviceNo: "44401",
      platBillNo: "8ac7a4a1",
      productId: "1",
      orderNo: "201701041632542085957405",
      orderAmount: "600",
      isFinish: "SUCCESS",
    };

    const verified = verifyInbound(envelope(data, { exclude: ["platBillNo"] }), ProductDoneDataSchema, {
      env: ENV,
    });

    expect(verified.data.platBillNo).toBe("8ac7a4a1");
  });

  it("refuses everything when no apikey is configured", () => {
    expect(() =>
      verifyInbound(envelope(qrRequest()), GetQrCodeDataSchema, { env: { JETINNO_USERNAME: "x" } }),
    ).toThrow(/not configured/);
  });
});

describe("response envelope", () => {
  /**
   * §2.3: returnCode is SUCCESS or FAIL, at most 10 characters. The §4.1 code
   * goes in msg — ORDER_NOT_EXIST alone is 15 characters.
   */
  it("answers FAIL with the §4.1 code in msg", async () => {
    const response = jetinnoErrorResponse(
      "test",
      new JetinnoError(JetinnoCode.ORDER_NOT_EXIST, "no such order"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.returnCode).toBe(JetinnoCode.FAIL);
    expect(body.msg).toBe(JetinnoCode.ORDER_NOT_EXIST);
  });

  it("answers SUCCESS as returnCode and msg", async () => {
    const body = await jetinnoResponse(JetinnoCode.SUCCESS).json();

    expect(body.returnCode).toBe(JetinnoCode.SUCCESS);
    expect(body.msg).toBe(JetinnoCode.SUCCESS);
  });
});

describe("payment callback — telling the machine", () => {
  function jetinnoOrder() {
    const { order } = createJetinnoOrder({
      config: CONFIG,
      data: GetQrCodeDataSchema.parse(qrRequest()),
      currency: "AED",
    });
    return setOrderStatus(order.id, OrderStatus.PAID)!;
  }

  function stubFetch(responses: Array<{ ok: boolean; returnCode?: string }>) {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    let index = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        const next = responses[Math.min(index++, responses.length - 1)];
        return {
          ok: next.ok,
          status: next.ok ? 200 : 500,
          json: async () => ({ returnCode: next.returnCode ?? "SUCCESS" }),
        } as Response;
      }),
    );

    return calls;
  }

  it("posts a signed PAYSUCCESS to the machine's own callback address", async () => {
    const order = jetinnoOrder();
    const calls = stubFetch([{ ok: true, returnCode: JetinnoCode.SUCCESS }]);

    const outcome = await notifyPaymentResult(order, {
      payStatus: payStatusFor(true),
      platBillNo: "8ac7a4a1",
      env: ENV,
    });

    expect(outcome.delivered).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://machine.example.com/callback");

    const body = calls[0].body as { username: string; time: string; sign: string; data: Record<string, unknown> };
    expect(body.data.payStatus).toBe(JetinnoPayStatus.PAYSUCCESS);
    // Reported in the same cents the machine originally stated.
    expect(body.data.orderAmount).toBe("600");
    expect(body.data.platBillNo).toBe("8ac7a4a1");

    // §3.3.2: payType participates in this signature, unlike §3.1.2; the
    // optional platBillNo does not (§2.4 rule 6). Checked strictly, not via
    // verifySignature, which would accept either reading.
    expect(body.sign).toBe(
      signFields({ username: body.username, time: body.time, ...body.data }, ENV.JETINNO_APIKEY, {
        exclude: ["platBillNo"],
      }),
    );
  });

  it("reports a failed payment as PAYERROR", async () => {
    const order = jetinnoOrder();
    const calls = stubFetch([{ ok: true, returnCode: JetinnoCode.SUCCESS }]);

    await notifyPaymentResult(order, { payStatus: payStatusFor(false), env: ENV });

    expect(calls[0].body.data).toMatchObject({ payStatus: JetinnoPayStatus.PAYERROR });
  });

  it("retries until the machine acknowledges", async () => {
    const order = jetinnoOrder();
    const calls = stubFetch([
      { ok: false },
      { ok: true, returnCode: JetinnoCode.SUCCESS },
    ]);

    const outcome = await notifyPaymentResult(order, { payStatus: payStatusFor(true), env: ENV });

    expect(outcome.delivered).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  /** A 200 carrying FAIL is a refusal. Stamping it as delivered would silence us forever. */
  it("does not treat a FAIL return code as delivery", async () => {
    const order = jetinnoOrder();
    stubFetch([{ ok: true, returnCode: JetinnoCode.FAIL }]);

    const outcome = await notifyPaymentResult(order, { payStatus: payStatusFor(true), env: ENV });

    expect(outcome.delivered).toBe(false);
  });

  it("does not send twice for the same order", async () => {
    const order = jetinnoOrder();
    const calls = stubFetch([{ ok: true, returnCode: JetinnoCode.SUCCESS }]);

    await notifyPaymentResult(order, { payStatus: payStatusFor(true), env: ENV });
    const sent = calls.length;

    // The result page and the AFS webhook both fire; the second must be a no-op.
    const again = await notifyPaymentResult(
      { ...order, notifiedAt: new Date().toISOString() },
      { payStatus: payStatusFor(true), env: ENV },
    );

    expect(again.skipped).toBe("already-notified");
    expect(calls).toHaveLength(sent);
  });

  it("stays silent for an order that did not come from Jetinno", async () => {
    const calls = stubFetch([{ ok: true }]);
    const order = jetinnoOrder();

    const outcome = await notifyPaymentResult(
      { ...order, source: OrderSource.MACHINE_API, external: null },
      { payStatus: payStatusFor(true), env: ENV },
    );

    expect(outcome.skipped).toBe("not-jetinno");
    expect(calls).toHaveLength(0);
  });

  it("has nowhere to report when the machine sent no notifyUrl", async () => {
    const calls = stubFetch([{ ok: true }]);
    const order = jetinnoOrder();

    const outcome = await notifyPaymentResult(
      { ...order, external: { ...order.external!, notifyUrl: null } },
      { payStatus: payStatusFor(true), env: ENV },
    );

    expect(outcome.skipped).toBe("no-notify-url");
    expect(calls).toHaveLength(0);
  });
});
