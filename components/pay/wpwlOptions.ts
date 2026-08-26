import { PaymentMethod } from "@/lib/payments/payment";
import type { WalletClientConfig } from "@/lib/payments/wallets";

/**
 * Builds `window.wpwlOptions`, the single object the AFS Copy&Pay widget reads
 * when its script boots.
 *
 * Kept out of the component, and pure, for two reasons: the widget reads the
 * global exactly once at load time so getting it wrong is invisible until a
 * real device fails, and the wallet branches are the part most worth unit
 * testing.
 *
 * The amount and currency come from the checkout the SERVER created, never from
 * the price rendered on the page. The Apple Pay sheet shows a total, and that
 * total must be the one AFS will actually charge.
 */

export interface WalletCheckoutAmount {
  amount: string;
  currency: string;
}

/** Callbacks the component supplies so a dismissed sheet is not a dead end. */
export interface WalletCallbacks {
  onCancel?: () => void;
}

export function buildWpwlOptions(
  method: PaymentMethod,
  checkout: WalletCheckoutAmount,
  wallets: WalletClientConfig,
  callbacks: WalletCallbacks = {},
): Record<string, unknown> {
  const options: Record<string, unknown> = { locale: "en", style: "card" };

  if (method === PaymentMethod.APPLE_PAY && wallets.applePay) {
    const config = wallets.applePay;
    options.applePay = {
      version: config.version,
      checkAvailability: config.checkAvailability,
      ...(config.merchantIdentifier ? { merchantIdentifier: config.merchantIdentifier } : {}),
      buttonSource: config.buttonSource,
      buttonStyle: config.buttonStyle,
      buttonType: config.buttonType,
      displayName: config.displayName,
      countryCode: config.countryCode,
      currencyCode: checkout.currency,
      supportedNetworks: config.supportedNetworks,
      merchantCapabilities: config.merchantCapabilities,
      // "final", not "pending": we know the exact amount, so the sheet should
      // show it rather than the word "Pending".
      total: { label: config.displayName, amount: checkout.amount, type: "final" },
      // Nothing is shipped, so no shipping methods and no shipping callbacks.
      ...(config.collectContact
        ? {
            requiredBillingContactFields: ["postalAddress"],
            requiredShippingContactFields: ["email", "name"],
            submitOnPaymentAuthorized: ["customer", "billing"],
          }
        : {}),
      ...(callbacks.onCancel ? { onCancel: callbacks.onCancel } : {}),
    };
  }

  if (method === PaymentMethod.GOOGLE_PAY && wallets.googlePay) {
    const config = wallets.googlePay;
    options.googlePay = {
      gatewayMerchantId: config.gatewayMerchantId,
      ...(config.merchantId ? { merchantId: config.merchantId } : {}),
      ...(config.gateway ? { gateway: config.gateway } : {}),
      merchantName: config.merchantName,
      allowedAuthMethods: config.allowedAuthMethods,
      allowedCardNetworks: config.allowedCardNetworks,
      buttonColor: config.buttonColor,
      buttonType: config.buttonType,
      buttonSizeMode: config.buttonSizeMode,
      // The amount is already final when the sheet opens, so the sheet's button
      // should say "Pay now" rather than "Continue".
      checkoutOption: "COMPLETE_IMMEDIATE_PURCHASE",
      ...(config.collectContact
        ? {
            emailRequired: true,
            billingAddressRequired: true,
            billingAddressParameters: { format: "FULL" },
            submitOnPaymentAuthorized: ["customer", "billing"],
          }
        : {}),
      // Without this, closing the Google Pay sheet falls through to
      // wpwlOptions.onError and reads to the customer as a failure.
      ...(callbacks.onCancel ? { onCancel: callbacks.onCancel } : {}),
    };
  }

  return options;
}
