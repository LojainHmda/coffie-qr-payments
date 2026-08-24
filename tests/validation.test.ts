import { describe, expect, it } from "vitest";

import { listMachines } from "@/lib/catalog/machines";
import {
  CreateCheckoutRequestSchema,
  CreateOrderRequestSchema,
  CreateTestCheckoutRequestSchema,
  PaymentStatusQuerySchema,
} from "@/lib/validation/payment";

const MACHINE_TOKEN = listMachines()[0].publicToken;
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

describe("CreateOrderRequestSchema", () => {
  it("accepts a machine token and a product id", () => {
    const parsed = CreateOrderRequestSchema.safeParse({
      machineToken: MACHINE_TOKEN,
      productId: "prd_coffee",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a client-supplied price", () => {
    const parsed = CreateOrderRequestSchema.safeParse({
      machineToken: MACHINE_TOKEN,
      productId: "prd_coffee",
      price: "0.01",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a client-supplied amount or currency", () => {
    for (const extra of [{ amount: "0.01" }, { currency: "USD" }, { total: "0.01" }]) {
      const parsed = CreateOrderRequestSchema.safeParse({
        machineToken: MACHINE_TOKEN,
        productId: "prd_coffee",
        ...extra,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it("rejects a path-traversal machine token", () => {
    const parsed = CreateOrderRequestSchema.safeParse({
      machineToken: "../../admin",
      productId: "prd_coffee",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("CreateCheckoutRequestSchema", () => {
  it("accepts a machine token, order id and method", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      machineToken: MACHINE_TOKEN,
      orderId: ORDER_ID,
      method: "CARD",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an unknown payment method", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      machineToken: MACHINE_TOKEN,
      orderId: ORDER_ID,
      method: "BITCOIN",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a client-supplied amount", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      machineToken: MACHINE_TOKEN,
      orderId: ORDER_ID,
      method: "CARD",
      amount: "0.01",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a client-supplied status", () => {
    const parsed = CreateCheckoutRequestSchema.safeParse({
      machineToken: MACHINE_TOKEN,
      orderId: ORDER_ID,
      method: "CARD",
      status: "SUCCESS",
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
