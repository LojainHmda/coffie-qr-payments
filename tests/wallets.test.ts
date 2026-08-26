import { describe, expect, it } from "vitest";

import { buildWpwlOptions } from "@/components/pay/wpwlOptions";
import { PaymentMethod } from "@/lib/payments/payment";
import {
  googlePayEnvironment,
  walletClientConfig,
  walletConfigProblems,
  type WalletClientConfig,
} from "@/lib/payments/wallets";

/**
 * The wallet configuration is invisible until a real device tries to pay, so
 * the rules it has to satisfy are pinned here instead:
 *
 *   - a wallet that is not enabled sends no configuration at all;
 *   - Google Pay never ships without gatewayMerchantId, because it cannot work;
 *   - the access token never appears in anything the browser receives;
 *   - the Apple Pay sheet's total is the checkout amount, not the page price.
 */

const BASE_ENV = {
  AFS_ENTITY_ID: "8ac7a4c97d8d45be017d8e96389e020a",
  AFS_ACCESS_TOKEN: "super-secret-token",
  AFS_BASE_URL: "https://eu-test.oppwa.com/",
  AFS_CURRENCY: "AED",
};

describe("walletClientConfig", () => {
  it("sends no wallet configuration when no wallet is enabled", () => {
    expect(walletClientConfig(BASE_ENV)).toEqual({ applePay: null, googlePay: null });
  });

  it("configures Apple Pay when it is enabled", () => {
    const config = walletClientConfig({ ...BASE_ENV, AFS_WALLET_METHODS: "APPLE_PAY" });

    expect(config.googlePay).toBeNull();
    expect(config.applePay).toMatchObject({
      version: 3,
      countryCode: "AE",
      merchantCapabilities: ["supports3DS"],
      supportedNetworks: ["visa", "masterCard"],
    });
    // With a merchant identifier available, use the check that also reports
    // whether the customer has a usable card.
    expect(config.applePay?.checkAvailability).toBe("applePayCapabilities");
    expect(config.applePay?.merchantIdentifier).toBe(BASE_ENV.AFS_ENTITY_ID);
  });

  it("configures Google Pay with the entity id as gatewayMerchantId", () => {
    const config = walletClientConfig({ ...BASE_ENV, AFS_WALLET_METHODS: "GOOGLE_PAY" });

    expect(config.applePay).toBeNull();
    expect(config.googlePay).toMatchObject({
      gatewayMerchantId: BASE_ENV.AFS_ENTITY_ID,
      environment: "TEST",
      allowedCardNetworks: ["VISA", "MASTERCARD"],
      allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
    });
  });

  it("drops Google Pay rather than shipping it without a gatewayMerchantId", () => {
    const config = walletClientConfig({
      ...BASE_ENV,
      AFS_ENTITY_ID: "",
      AFS_WALLET_METHODS: "GOOGLE_PAY",
    });

    expect(config.googlePay).toBeNull();
    expect(walletConfigProblems({ ...BASE_ENV, AFS_ENTITY_ID: "", AFS_WALLET_METHODS: "GOOGLE_PAY" })).toEqual([
      expect.stringContaining("gatewayMerchantId"),
    ]);
  });

  it("never puts the access token in anything the browser receives", () => {
    const config = walletClientConfig({
      ...BASE_ENV,
      AFS_WALLET_METHODS: "APPLE_PAY,GOOGLE_PAY",
    });

    expect(JSON.stringify(config)).not.toContain(BASE_ENV.AFS_ACCESS_TOKEN);
  });

  it("translates card networks into each vendor's spelling", () => {
    const config = walletClientConfig({
      ...BASE_ENV,
      AFS_WALLET_METHODS: "APPLE_PAY,GOOGLE_PAY",
      AFS_WALLET_NETWORKS: "visa, mastercard, amex",
    });

    expect(config.applePay?.supportedNetworks).toEqual(["visa", "masterCard", "amex"]);
    expect(config.googlePay?.allowedCardNetworks).toEqual(["VISA", "MASTERCARD", "AMEX"]);
  });

  it("passes the acquirer gateway through only for ACQUIRER decryption", () => {
    const acquirer = walletClientConfig({
      ...BASE_ENV,
      AFS_WALLET_METHODS: "GOOGLE_PAY",
      AFS_WALLET_DECRYPTION: "ACQUIRER",
      AFS_GOOGLE_PAY_GATEWAY: "sonypaymentservices",
    });
    const platform = walletClientConfig({
      ...BASE_ENV,
      AFS_WALLET_METHODS: "GOOGLE_PAY",
      AFS_GOOGLE_PAY_GATEWAY: "sonypaymentservices",
    });

    expect(acquirer.googlePay?.gateway).toBe("sonypaymentservices");
    expect(platform.googlePay?.gateway).toBeNull();
  });
});

describe("googlePayEnvironment", () => {
  it("follows the AFS host instead of a separate switch", () => {
    expect(googlePayEnvironment({ AFS_BASE_URL: "https://eu-test.oppwa.com/" })).toBe("TEST");
    expect(googlePayEnvironment({ AFS_BASE_URL: "https://eu-prod.oppwa.com/" })).toBe("PRODUCTION");
    // Unset means the TEST default applies in lib/payments/afs/config.ts too.
    expect(googlePayEnvironment({})).toBe("TEST");
  });
});

describe("walletConfigProblems", () => {
  it("flags a production Google Pay setup with no Google merchant id", () => {
    expect(
      walletConfigProblems({
        ...BASE_ENV,
        AFS_BASE_URL: "https://eu-prod.oppwa.com/",
        AFS_WALLET_METHODS: "GOOGLE_PAY",
      }),
    ).toEqual([expect.stringContaining("AFS_GOOGLE_PAY_MERCHANT_ID")]);
  });

  it("is silent when nothing is wrong", () => {
    expect(walletConfigProblems({ ...BASE_ENV, AFS_WALLET_METHODS: "APPLE_PAY" })).toEqual([]);
  });
});

describe("buildWpwlOptions", () => {
  const wallets = walletClientConfig({
    ...BASE_ENV,
    AFS_WALLET_METHODS: "APPLE_PAY,GOOGLE_PAY",
    AFS_WALLET_DISPLAY_NAME: "Coffee Machine",
  }) as WalletClientConfig;

  const checkout = { amount: "3.00", currency: "AED" };

  it("adds no wallet options for a card payment", () => {
    const options = buildWpwlOptions(PaymentMethod.CARD, checkout, wallets);

    expect(options).toEqual({ locale: "en", style: "card" });
  });

  it("puts the checkout amount on the Apple Pay sheet", () => {
    const options = buildWpwlOptions(PaymentMethod.APPLE_PAY, checkout, wallets);
    const applePay = options.applePay as Record<string, unknown>;

    expect(applePay.total).toEqual({ label: "Coffee Machine", amount: "3.00", type: "final" });
    expect(applePay.currencyCode).toBe("AED");
    expect(options.googlePay).toBeUndefined();
  });

  it("sends Google Pay's mandatory gatewayMerchantId", () => {
    const options = buildWpwlOptions(PaymentMethod.GOOGLE_PAY, checkout, wallets);
    const googlePay = options.googlePay as Record<string, unknown>;

    expect(googlePay.gatewayMerchantId).toBe(BASE_ENV.AFS_ENTITY_ID);
    expect(googlePay.checkoutOption).toBe("COMPLETE_IMMEDIATE_PURCHASE");
    expect(options.applePay).toBeUndefined();
  });

  it("omits contact collection unless it is switched on", () => {
    const options = buildWpwlOptions(PaymentMethod.GOOGLE_PAY, checkout, wallets);
    const googlePay = options.googlePay as Record<string, unknown>;

    expect(googlePay.billingAddressRequired).toBeUndefined();
    expect(googlePay.submitOnPaymentAuthorized).toBeUndefined();

    const collecting = walletClientConfig({
      ...BASE_ENV,
      AFS_WALLET_METHODS: "GOOGLE_PAY",
      AFS_WALLET_COLLECT_CONTACT: "true",
    });
    const withContact = buildWpwlOptions(PaymentMethod.GOOGLE_PAY, checkout, collecting)
      .googlePay as Record<string, unknown>;

    expect(withContact.emailRequired).toBe(true);
    expect(withContact.submitOnPaymentAuthorized).toEqual(["customer", "billing"]);
  });

  it("cannot configure a wallet the merchant gate did not enable", () => {
    const cardOnly = walletClientConfig(BASE_ENV);

    expect(buildWpwlOptions(PaymentMethod.APPLE_PAY, checkout, cardOnly)).toEqual({
      locale: "en",
      style: "card",
    });
  });
});
