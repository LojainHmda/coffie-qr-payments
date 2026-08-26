import { describe, expect, it } from "vitest";

import {
  CreateCheckoutRequestSchema,
  CreateMachineOrderRequestSchema,
  CreateTestCheckoutRequestSchema,
  MachineOrderIdSchema,
  PaymentStatusQuerySchema,
} from "@/lib/validation/payment";

/** 32 url-safe characters, the shape lib/orders/store.ts mints. */
const PAY_TOKEN = "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MA";
const ORDER_ID = "ord_11111111-2222-3333-4444-555555555555";

describe("CreateTestCheckoutRequestSchema", () => {
  it("accepts an empty body", () => {
    expect(CreateTestCheckoutRequestSchema.safeParse({}).success).toBe(true);
  });

  it("accepts a machine id", () => {
    const parsed = CreateTestCheckoutRequestSchema.safeParse({ machineId: "MACHINE-001" });
    expect(parsed.success).toBe(true);
  });

  it("rejects a client-supplied amount", () => {
    expect(CreateTestCheckoutRequestSchema.safeParse({ amount: "0.01" }).success).toBe(false);
  });

  it("rejects a client-supplied currency", () => {
    expect(CreateTestCheckoutRequestSchema.safeParse({ currency: "USD" }).success).toBe(false);
  });

  it("rejects a malformed machine id", () => {
    expect(CreateTestCheckoutRequestSchema.safeParse({ machineId: "../../etc" }).success).toBe(false);
  });
});

describe("CreateMachineOrderRequestSchema", () => {
  it("accepts product ids and quantities", () => {
    const parsed = CreateMachineOrderRequestSchema.safeParse({
      lines: [
        { productId: "prd_coffee", quantity: 2 },
        { productId: "prd_latte", quantity: 1 },
      ],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a machine naming itself in the body", () => {
    // Identity comes from the API key. A body that claims a machine is either
    // a bug or an attempt to write an order against someone else's machine.
    const parsed = CreateMachineOrderRequestSchema.safeParse({
      machineId: "mch_002",
      lines: [{ productId: "prd_coffee", quantity: 1 }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a machine-supplied price", () => {
    for (const extra of [{ price: "0.01" }, { total: "0.01" }, { currency: "USD" }]) {
      const parsed = CreateMachineOrderRequestSchema.safeParse({
        lines: [{ productId: "prd_coffee", quantity: 1 }],
        ...extra,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects an empty basket", () => {
    expect(CreateMachineOrderRequestSchema.safeParse({ lines: [] }).success).toBe(false);
  });

  it("rejects quantities that are not sane cup counts", () => {
    for (const quantity of [0, -1, 21, 1.5, "2"]) {
      const parsed = CreateMachineOrderRequestSchema.safeParse({
        lines: [{ productId: "prd_coffee", quantity }],
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe("MachineOrderIdSchema", () => {
  it("accepts our order id shape and rejects a traversal", () => {
    expect(MachineOrderIdSchema.safeParse(ORDER_ID).success).toBe(true);
    expect(MachineOrderIdSchema.safeParse("../../admin").success).toBe(false);
  });
});

describe("CreateCheckoutRequestSchema", () => {
  it("accepts a pay token and a method", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      payToken: PAY_TOKEN,
      method: "CARD",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown payment method", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      payToken: PAY_TOKEN,
      method: "BITCOIN",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a client-supplied amount", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      payToken: PAY_TOKEN,
      method: "CARD",
      amount: "0.01",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a client-supplied status", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      payToken: PAY_TOKEN,
      method: "CARD",
      status: "SUCCESS",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a client naming the order or the machine directly", () => {
    // The phone holds a token, not an order id: it must not be able to point
    // the checkout at an order it did not scan.
    for (const extra of [{ orderId: ORDER_ID }, { machineId: "mch_001" }]) {
      const parsed = CreateCheckoutRequestSchema.safeParse({
        payToken: PAY_TOKEN,
        method: "CARD",
        ...extra,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects a path-traversal pay token", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      payToken: "../../admin",
      method: "CARD",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("PaymentStatusQuerySchema", () => {
  it("accepts the documented resourcePath shape", () => {
    const parsed = PaymentStatusQuerySchema.safeParse({
      resourcePath: "/v1/checkouts/ABC123.uat01-vm-tx02/payment",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty resourcePath", () => {
    expect(PaymentStatusQuerySchema.safeParse({ resourcePath: "" }).success).toBe(false);
  });

  it("rejects a path traversal attempt", () => {
    expect(
      PaymentStatusQuerySchema.safeParse({ resourcePath: "/v1/checkouts/../../admin/payment" })
        .success,
    ).toBe(false);
  });

  it("rejects an absolute URL", () => {
    expect(
      PaymentStatusQuerySchema.safeParse({ resourcePath: "https://evil.example/v1/x/payment" })
        .success,
    ).toBe(false);
  });
});
