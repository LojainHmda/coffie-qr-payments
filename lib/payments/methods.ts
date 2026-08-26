import { PaymentMethod } from "./payment";

/**
 * Which payment methods this merchant can actually take.
 *
 * ---------------------------------------------------------------------------
 * MEASURED, NOT ASSUMED.
 *
 * The configured AFS entity was probed against the live TEST gateway. For a
 * real checkout on our entity, the Copy&Pay widget resolves:
 *
 *   "brandConfig": { "brands": ["MASTER","VISA"], "overrideShopBrands": true }
 *
 * and the widget payload contains no `applePayConfig` and no `googlePayConfig`
 * object at all (it does contain samsungPayConfig, pazeConfig, clickToPayConfig
 * and friends, so their absence is meaningful).
 *
 * Note that `POST /v1/checkouts` happily accepts `paymentBrand=APPLEPAY` and
 * returns 000.200.100 — AFS does not validate brand provisioning at checkout
 * creation. That response is NOT evidence of wallet support. The resolved
 * widget brand list is.
 *
 * Conclusion: Apple Pay and Google Pay are NOT enabled on this entity today,
 * so this module offers CARD only and the UI renders no wallet buttons.
 *
 * ---------------------------------------------------------------------------
 * TO ENABLE A WALLET (nothing here needs rewriting — it is config):
 *
 * Apple Pay
 *   1. AFS enables the APPLEPAY brand on the entity.
 *   2. Apple Merchant ID + payment-processing certificate exchanged with AFS.
 *   3. Every serving domain registered with Apple AND serving
 *      /.well-known/apple-developer-merchantid-domain-association.
 *   4. HTTPS on a public domain. A LAN address like http://192.168.1.45:3000
 *      can never show Apple Pay.
 *   5. Safari / iOS WebKit only.
 *
 * Google Pay
 *   1. AFS enables the GOOGLEPAY brand and supplies the gateway merchant id.
 *   2. Google Pay Business Console merchant id (TEST works pre-approval).
 *   3. HTTPS — the API requires a secure context.
 *   4. Chrome / Chromium / Android.
 *
 * Then set AFS_WALLET_METHODS=APPLE_PAY,GOOGLE_PAY (or either one) and the
 * buttons appear for the devices that also pass the browser check in
 * components/pay/useAvailablePaymentMethods.ts.
 *
 * The widget-side configuration both wallets need — Apple's total,
 * supportedNetworks and merchantIdentifier, Google's mandatory
 * gatewayMerchantId — is built in lib/payments/wallets.ts and applied to
 * window.wpwlOptions in components/pay/wpwlOptions.ts.
 * ---------------------------------------------------------------------------
 */

/**
 * Copy&Pay brand tokens, for the widget's `data-brands` attribute.
 *
 * The wallet entries have two forms. APPLEPAY / GOOGLEPAY mean AFS decrypts the
 * wallet token; APPLEPAYTKN / GOOGLEPAYTKN mean the acquirer does.
 * AFS_WALLET_DECRYPTION picks between them and defaults to the AFS-decrypts
 * form, which is the one that needs no extra acquirer configuration.
 */
const BRANDS: Record<PaymentMethod, string> = {
  CARD: "VISA MASTER",
  APPLE_PAY: "APPLEPAY",
  GOOGLE_PAY: "GOOGLEPAY",
};

const ACQUIRER_BRANDS: Partial<Record<PaymentMethod, string>> = {
  APPLE_PAY: "APPLEPAYTKN",
  GOOGLE_PAY: "GOOGLEPAYTKN",
};

const WALLET_METHODS = new Set<PaymentMethod>([PaymentMethod.APPLE_PAY, PaymentMethod.GOOGLE_PAY]);

/**
 * Methods the merchant account supports. Card is always on; wallets only when
 * AFS_WALLET_METHODS explicitly names them, so an unconfigured environment can
 * never accidentally render a wallet button that would fail.
 */
export function merchantEnabledMethods(
  env: Record<string, string | undefined> = process.env,
): PaymentMethod[] {
  const configured = (env.AFS_WALLET_METHODS ?? "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry): entry is PaymentMethod => WALLET_METHODS.has(entry as PaymentMethod));

  return [PaymentMethod.CARD, ...new Set(configured)];
}

export function isMethodEnabled(
  method: PaymentMethod,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return merchantEnabledMethods(env).includes(method);
}

/** Copy&Pay `data-brands` value for a chosen method. */
export function brandsForMethod(
  method: PaymentMethod,
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.AFS_WALLET_DECRYPTION?.trim().toUpperCase() === "ACQUIRER") {
    return ACQUIRER_BRANDS[method] ?? BRANDS[method];
  }
  return BRANDS[method];
}
