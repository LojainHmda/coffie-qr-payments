import { merchantEnabledMethods } from "./methods";
import { PaymentMethod } from "./payment";

/**
 * Wallet (Apple Pay / Google Pay) configuration for the Copy&Pay widget.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * Rendering a wallet button is not just "add APPLEPAY to data-brands". The AFS
 * Copy&Pay widget wraps the Apple Pay JS API and the Google Pay API, and both
 * need merchant-level configuration that AFS cannot infer from the checkout:
 *
 *   Apple Pay  — total, currencyCode, countryCode, supportedNetworks,
 *                merchantCapabilities, and (for the applePayCapabilities
 *                availability check) a merchantIdentifier.
 *   Google Pay — gatewayMerchantId (our AFS entity id) is REQUIRED, plus a
 *                Google merchantId once the site is approved for production.
 *
 * That configuration is delivered through `window.wpwlOptions.applePay` and
 * `window.wpwlOptions.googlePay`, which live in the browser. So this module
 * produces a *browser-safe* object: merchant identifiers and display data only.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS SAFE TO SEND TO THE BROWSER
 *
 * `AFS_ENTITY_ID` is sent, as `googlePay.gatewayMerchantId`. That is required
 * by the documented integration and the entity id is a merchant identifier,
 * not a credential — the widget already resolves it in the browser from the
 * checkout id. `AFS_ACCESS_TOKEN` is never read here and must never be.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DOES NOT DO
 *
 * It does not decide whether a wallet is *offered*. Two gates do that, and both
 * still apply:
 *   1. the merchant gate — lib/payments/methods.ts / AFS_WALLET_METHODS;
 *   2. the device gate — components/pay/useAvailablePaymentMethods.ts.
 * A fully configured wallet that AFS has not provisioned still shows no button.
 */

/** What the browser needs to configure `wpwlOptions.applePay`. */
export interface ApplePayClientConfig {
  /** Apple Pay JS API version. Lowest version that carries what we need. */
  version: number;
  /** How the widget decides the device can pay. */
  checkAvailability: "canMakePayments" | "applePayCapabilities";
  /** Apple Merchant ID, or the AFS entity id when using AFS's certificates. */
  merchantIdentifier: string | null;
  buttonSource: "css" | "js";
  buttonStyle: "black" | "white" | "white-outline";
  buttonType: string;
  /** Shown in the Touch Bar and used as the payment-sheet total label. */
  displayName: string;
  countryCode: string;
  currencyCode: string;
  /** Apple's spelling of the card networks, e.g. "masterCard". */
  supportedNetworks: string[];
  merchantCapabilities: string[];
  /** Ask the sheet for contact/billing details and submit them with the payment. */
  collectContact: boolean;
}

/** What the browser needs to configure `wpwlOptions.googlePay`. */
export interface GooglePayClientConfig {
  /** Required by Google Pay. This is the AFS entity id. */
  gatewayMerchantId: string;
  /** Google Pay Business Console merchant id. Required in production. */
  merchantId: string | null;
  /** Only for GOOGLEPAYTKN, where the acquirer decrypts the token. */
  gateway: string | null;
  merchantName: string;
  /** Drives the availability probe's PaymentsClient. */
  environment: "TEST" | "PRODUCTION";
  allowedAuthMethods: string[];
  /** Google's spelling of the card networks, e.g. "MASTERCARD". */
  allowedCardNetworks: string[];
  buttonColor: "default" | "black" | "white";
  buttonType: string;
  buttonSizeMode: "static" | "fill";
  collectContact: boolean;
}

/**
 * The whole wallet configuration handed to the client. A null entry means the
 * merchant gate did not enable that wallet, so nothing about it is sent and no
 * vendor SDK is ever loaded for it.
 */
export interface WalletClientConfig {
  applePay: ApplePayClientConfig | null;
  googlePay: GooglePayClientConfig | null;
}

/**
 * Who decrypts the wallet token.
 *
 * PLATFORM — AFS decrypts it. Brands are APPLEPAY / GOOGLEPAY. The default.
 * ACQUIRER — the acquirer decrypts it. Brands become APPLEPAYTKN / GOOGLEPAYTKN
 *            and Google Pay additionally needs `gateway`.
 */
export type WalletDecryption = "PLATFORM" | "ACQUIRER";

export function walletDecryption(env: WalletEnv = process.env): WalletDecryption {
  return env.AFS_WALLET_DECRYPTION?.trim().toUpperCase() === "ACQUIRER" ? "ACQUIRER" : "PLATFORM";
}

export type WalletEnv = Record<string, string | undefined>;

/** Card networks we accept, in our own neutral spelling. */
const DEFAULT_NETWORKS = ["VISA", "MASTERCARD"];

/** Our spelling -> Apple's. Networks Apple does not know are dropped. */
const APPLE_NETWORKS: Record<string, string> = {
  VISA: "visa",
  MASTERCARD: "masterCard",
  AMEX: "amex",
  DISCOVER: "discover",
  JCB: "jcb",
  MAESTRO: "maestro",
  MADA: "mada",
  ELECTRON: "electron",
};

/** Our spelling -> Google's. Google supports only these five. */
const GOOGLE_NETWORKS: Record<string, string> = {
  VISA: "VISA",
  MASTERCARD: "MASTERCARD",
  AMEX: "AMEX",
  DISCOVER: "DISCOVER",
  JCB: "JCB",
};

function configuredNetworks(env: WalletEnv): string[] {
  const raw = env.AFS_WALLET_NETWORKS?.trim();
  if (!raw) return DEFAULT_NETWORKS;
  const parsed = raw
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : DEFAULT_NETWORKS;
}

function mapNetworks(networks: string[], table: Record<string, string>): string[] {
  const mapped = networks.map((network) => table[network]).filter((value): value is string => !!value);
  return mapped.length > 0 ? mapped : networks.map((n) => table[n] ?? "").filter(Boolean);
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * TEST or PRODUCTION, derived from the AFS host rather than configured
 * separately — one fewer variable that can disagree with reality.
 */
export function googlePayEnvironment(env: WalletEnv = process.env): "TEST" | "PRODUCTION" {
  const baseUrl = env.AFS_BASE_URL?.trim() ?? "";
  return /(^|\/\/)[^/]*-test\./.test(baseUrl) || baseUrl === "" ? "TEST" : "PRODUCTION";
}

/**
 * Build the browser-safe wallet configuration.
 *
 * Reads the environment directly instead of going through `getAfsConfig()` so
 * that a page can render its payment-method choice on a server with no AFS
 * credentials configured. A missing entity id disables Google Pay rather than
 * throwing, because Google Pay genuinely cannot work without it.
 */
export function walletClientConfig(env: WalletEnv = process.env): WalletClientConfig {
  const enabled = merchantEnabledMethods(env);
  const networks = configuredNetworks(env);
  const displayName = env.AFS_WALLET_DISPLAY_NAME?.trim() || "Coffee Machine";
  const countryCode = (env.AFS_WALLET_COUNTRY?.trim() || "AE").toUpperCase();
  const collectContact = env.AFS_WALLET_COLLECT_CONTACT?.trim().toLowerCase() === "true";
  const entityId = trimmedOrNull(env.AFS_ENTITY_ID);

  // Apple Pay's applePayCapabilities check needs a merchant identifier. Without
  // one we fall back to canMakePayments, which is Apple's own default and needs
  // no identifier — it just cannot tell whether a card is provisioned.
  const appleMerchantId = trimmedOrNull(env.AFS_APPLE_PAY_MERCHANT_ID) ?? entityId;

  const applePay: ApplePayClientConfig | null = enabled.includes(PaymentMethod.APPLE_PAY)
    ? {
        version: 3,
        checkAvailability: appleMerchantId ? "applePayCapabilities" : "canMakePayments",
        merchantIdentifier: appleMerchantId,
        // "js" renders the button through Apple's own script, which is what
        // third-party browsers need when checkAvailability is
        // applePayCapabilities. It also avoids the buttonType gaps in the CSS
        // rendering path.
        buttonSource: "js",
        buttonStyle: "black",
        buttonType: "pay",
        displayName,
        countryCode,
        // Placeholder: the client overwrites this with the checkout currency,
        // which is the only authoritative one.
        currencyCode: env.AFS_CURRENCY?.trim() || "AED",
        supportedNetworks: mapNetworks(networks, APPLE_NETWORKS),
        // supports3DS is mandatory. Nothing else is added, so both credit and
        // debit cards stay allowed.
        merchantCapabilities: ["supports3DS"],
        collectContact,
      }
    : null;

  const googlePay: GooglePayClientConfig | null =
    enabled.includes(PaymentMethod.GOOGLE_PAY) && entityId
      ? {
          gatewayMerchantId: entityId,
          merchantId: trimmedOrNull(env.AFS_GOOGLE_PAY_MERCHANT_ID),
          gateway: walletDecryption(env) === "ACQUIRER" ? trimmedOrNull(env.AFS_GOOGLE_PAY_GATEWAY) : null,
          merchantName: displayName,
          environment: googlePayEnvironment(env),
          // CRYPTOGRAM_3DS covers cards tokenised on an Android device;
          // PAN_ONLY covers cards saved to the Google account.
          allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
          allowedCardNetworks: mapNetworks(networks, GOOGLE_NETWORKS),
          buttonColor: "black",
          buttonType: "pay",
          buttonSizeMode: "fill",
          collectContact,
        }
      : null;

  return { applePay, googlePay };
}

/**
 * Configuration problems worth surfacing to a developer, e.g. Google Pay named
 * in AFS_WALLET_METHODS but no entity id to use as gatewayMerchantId. Returned
 * rather than thrown: a misconfigured wallet must degrade to "no button", never
 * to a broken checkout page.
 */
export function walletConfigProblems(env: WalletEnv = process.env): string[] {
  const enabled = merchantEnabledMethods(env);
  const problems: string[] = [];

  if (enabled.includes(PaymentMethod.GOOGLE_PAY) && !trimmedOrNull(env.AFS_ENTITY_ID)) {
    problems.push(
      "GOOGLE_PAY is enabled but AFS_ENTITY_ID is empty; googlePay.gatewayMerchantId cannot be set.",
    );
  }
  if (
    enabled.includes(PaymentMethod.GOOGLE_PAY) &&
    googlePayEnvironment(env) === "PRODUCTION" &&
    !trimmedOrNull(env.AFS_GOOGLE_PAY_MERCHANT_ID)
  ) {
    problems.push(
      "GOOGLE_PAY is enabled against a production AFS host but AFS_GOOGLE_PAY_MERCHANT_ID is empty; Google requires it once the site is approved.",
    );
  }
  if (
    walletDecryption(env) === "ACQUIRER" &&
    enabled.includes(PaymentMethod.GOOGLE_PAY) &&
    !trimmedOrNull(env.AFS_GOOGLE_PAY_GATEWAY)
  ) {
    problems.push(
      "AFS_WALLET_DECRYPTION=ACQUIRER requires AFS_GOOGLE_PAY_GATEWAY for the GOOGLEPAYTKN brand.",
    );
  }

  return problems;
}
