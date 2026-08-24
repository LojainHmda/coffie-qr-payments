import { describe, expect, it } from "vitest";

import { sanitize } from "@/lib/payments/log";

describe("sanitize", () => {
  it("redacts sensitive keys", () => {
    const output = sanitize({
      accessToken: "super-secret",
      authorization: "Bearer abc",
      card: { number: "4200000000000000", cvv: "123", expiryMonth: "12" },
      amount: "5.00",
    }) as Record<string, unknown>;

    const serialised = JSON.stringify(output);
    expect(serialised).not.toContain("super-secret");
    expect(serialised).not.toContain("Bearer abc");
    expect(serialised).not.toContain("4200000000000000");
    expect(serialised).not.toContain("123");
    expect(output.amount).toBe("5.00");
  });

  it("masks card-shaped digit runs inside free text", () => {
    const output = sanitize("payment failed for 4200 0000 0000 0000") as string;
    expect(output).not.toContain("4200 0000 0000 0000");
    expect(output).toContain("[redacted]");
  });

  it("leaves ordinary values intact", () => {
    expect(sanitize({ status: "SUCCESS", resultCode: "000.100.110" })).toEqual({
      status: "SUCCESS",
      resultCode: "000.100.110",
    });
  });
});
