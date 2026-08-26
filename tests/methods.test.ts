import { describe, expect, it } from "vitest";

import { brandsForMethod, isMethodEnabled, merchantEnabledMethods } from "@/lib/payments/methods";
import { PaymentMethod } from "@/lib/payments/payment";

/**
 * The "do not fake wallet support" rule, enforced.
 *
 * Wallets must stay off unless somebody deliberately switches them on, because
 * the configured AFS entity does not have them provisioned — the widget config
 * for a real checkout on our entity resolves to brands ["MASTER","VISA"] and
 * carries no applePayConfig or googlePayConfig at all.
 */

describe("merchantEnabledMethods", () => {
  it("offers card only when nothing is configured", () => {
    expect(merchantEnabledMethods({})).toEqual([PaymentMethod.CARD]);
    expect(merchantEnabledMethods({ AFS_WALLET_METHODS: "" })).toEqual([PaymentMethod.CARD]);
  });

  it("ignores junk instead of guessing a wallet into existence", () => {
    expect(merchantEnabledMethods({ AFS_WALLET_METHODS: "PAYPAL,BITCOIN,CARD" })).toEqual([
      PaymentMethod.CARD,
    ]);
  });

  it("enables a wallet only when it is named explicitly", () => {
    expect(merchantEnabledMethods({ AFS_WALLET_METHODS: "APPLE_PAY" })).toEqual([
      PaymentMethod.CARD,
      PaymentMethod.APPLE_PAY,
    ]);
    expect(merchantEnabledMethods({ AFS_WALLET_METHODS: "apple_pay, google_pay" })).toEqual([
      PaymentMethod.CARD,
      PaymentMethod.APPLE_PAY,
      PaymentMethod.GOOGLE_PAY,
    ]);
  });

  it("never drops the card fallback", () => {
    expect(isMethodEnabled(PaymentMethod.CARD, { AFS_WALLET_METHODS: "APPLE_PAY" })).toBe(true);
  });
});

describe("brandsForMethod", () => {
  it("maps our methods onto Copy&Pay brand tokens", () => {
    expect(brandsForMethod(PaymentMethod.CARD, {})).toBe("VISA MASTER");
    expect(brandsForMethod(PaymentMethod.APPLE_PAY, {})).toBe("APPLEPAY");
    expect(brandsForMethod(PaymentMethod.GOOGLE_PAY, {})).toBe("GOOGLEPAY");
  });

  it("switches to the token brands when the acquirer decrypts", () => {
    const env = { AFS_WALLET_DECRYPTION: "ACQUIRER" };

    expect(brandsForMethod(PaymentMethod.APPLE_PAY, env)).toBe("APPLEPAYTKN");
    expect(brandsForMethod(PaymentMethod.GOOGLE_PAY, env)).toBe("GOOGLEPAYTKN");
    // Card is unaffected: there is no token variant of a card payment.
    expect(brandsForMethod(PaymentMethod.CARD, env)).toBe("VISA MASTER");
  });
});
