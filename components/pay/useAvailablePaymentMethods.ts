"use client";

import { useEffect, useState } from "react";

import { PaymentMethod } from "@/lib/payments/payment";
import type { WalletClientConfig } from "@/lib/payments/wallets";

/**
 * Which payment methods to actually put on screen.
 *
 * Two gates, both of which must pass:
 *
 *   1. the merchant gate — does AFS have this method provisioned on our
 *      entity? Decided on the server (lib/payments/methods.ts) and handed in
 *      as `enabled`. With AFS_WALLET_METHODS empty that is CARD only, and no
 *      wallet SDK below is ever loaded.
 *
 *   2. the device gate — can THIS browser really complete it? Checked here
 *      with the vendors' own availability APIs, never with user-agent
 *      sniffing and never assumed.
 *
 * A button appears only when both say yes. That is the whole point: a wallet
 * button that cannot complete a payment is worse than no wallet button.
 *
 * `reason` explains a wallet's absence to the developer (and, in general terms,
 * to the customer) instead of leaving a silently missing button.
 */

const GOOGLE_PAY_SDK = "https://pay.google.com/gp/p/js/pay.js";

interface GooglePayClient {
  isReadyToPay(request: unknown): Promise<{ result: boolean }>;
}

/** Apple's response to applePayCapabilities(). */
interface PaymentCredentialStatusResponse {
  paymentCredentialStatus:
    | "paymentCredentialsAvailable"
    | "paymentCredentialStatusUnknown"
    | "paymentCredentialsUnavailable"
    | "applePayUnsupported";
}

declare global {
  interface Window {
    ApplePaySession?: {
      canMakePayments(): boolean;
      supportsVersion(v: number): boolean;
      applePayCapabilities?(merchantIdentifier: string): Promise<PaymentCredentialStatusResponse>;
    };
    google?: {
      payments?: {
        api?: { PaymentsClient: new (options: { environment: string }) => GooglePayClient };
      };
    };
  }
}

/** Why a wallet is not on screen. "AVAILABLE" means it is. */
export type WalletUnavailableReason =
  | "AVAILABLE"
  | "NOT_ENABLED"
  | "INSECURE_CONTEXT"
  | "UNSUPPORTED_DEVICE"
  | "NO_CARD";

/**
 * Apple's own check.
 *
 * `canMakePayments` only proves the device speaks Apple Pay. When a merchant
 * identifier is configured we can use `applePayCapabilities`, which also asks
 * Apple whether this person has a card that qualifies for web payments — and
 * which works in third-party browsers, not just Safari.
 */
async function applePayAvailability(
  config: NonNullable<WalletClientConfig["applePay"]>,
): Promise<WalletUnavailableReason> {
  // Apple Pay is unavailable over plain http by design, so a LAN address can
  // never show the button no matter how the entity is provisioned.
  if (!window.isSecureContext) return "INSECURE_CONTEXT";

  const session = window.ApplePaySession;
  if (!session) return "UNSUPPORTED_DEVICE";

  try {
    if (!session.supportsVersion(config.version)) return "UNSUPPORTED_DEVICE";

    if (config.checkAvailability === "applePayCapabilities" && config.merchantIdentifier) {
      const capabilities = session.applePayCapabilities;
      if (capabilities) {
        const response = await capabilities.call(session, config.merchantIdentifier);
        switch (response.paymentCredentialStatus) {
          case "applePayUnsupported":
            return "UNSUPPORTED_DEVICE";
          case "paymentCredentialsUnavailable":
            return "NO_CARD";
          // "paymentCredentialStatusUnknown" still shows the button: Apple is
          // saying it cannot tell, not that payment will fail.
          default:
            return "AVAILABLE";
        }
      }
    }

    return session.canMakePayments() ? "AVAILABLE" : "UNSUPPORTED_DEVICE";
  } catch {
    return "UNSUPPORTED_DEVICE";
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(script);
  });
}

/**
 * Google's own check. Loads the Google Pay SDK — but only when the merchant
 * gate already passed, so nothing is fetched while Google Pay is disabled.
 */
async function googlePayAvailability(
  config: NonNullable<WalletClientConfig["googlePay"]>,
): Promise<WalletUnavailableReason> {
  // The Google Pay API requires a secure context.
  if (!window.isSecureContext) return "INSECURE_CONTEXT";
  try {
    await loadScript(GOOGLE_PAY_SDK);
    const api = window.google?.payments?.api;
    if (!api) return "UNSUPPORTED_DEVICE";

    const client = new api.PaymentsClient({ environment: config.environment });
    const response = await client.isReadyToPay({
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [
        {
          type: "CARD",
          parameters: {
            allowedAuthMethods: config.allowedAuthMethods,
            allowedCardNetworks: config.allowedCardNetworks,
          },
        },
      ],
    });
    return response.result === true ? "AVAILABLE" : "UNSUPPORTED_DEVICE";
  } catch {
    return "UNSUPPORTED_DEVICE";
  }
}

export interface AvailablePaymentMethods {
  /** In display order: wallets first, card last. Never empty. */
  methods: PaymentMethod[];
  /** False until both device checks have finished. */
  resolved: boolean;
  /** Per-wallet outcome, for the explanatory note under the buttons. */
  reasons: Record<PaymentMethod, WalletUnavailableReason>;
}

const NO_WALLETS: WalletClientConfig = { applePay: null, googlePay: null };

/**
 * Resolves the merchant-enabled list against this device. Starts as CARD only
 * so the page is usable on first paint and never flashes a wallet button that
 * then disappears.
 */
export function useAvailablePaymentMethods(
  enabled: PaymentMethod[],
  wallets: WalletClientConfig = NO_WALLETS,
): AvailablePaymentMethods {
  const [methods, setMethods] = useState<PaymentMethod[]>([PaymentMethod.CARD]);
  const [resolved, setResolved] = useState(false);
  const [reasons, setReasons] = useState<Record<PaymentMethod, WalletUnavailableReason>>({
    [PaymentMethod.CARD]: "AVAILABLE",
    [PaymentMethod.APPLE_PAY]: "NOT_ENABLED",
    [PaymentMethod.GOOGLE_PAY]: "NOT_ENABLED",
  });

  // `enabled` and `wallets` are server-rendered and stable for the life of the
  // page; serialising them keeps the effect from re-running on every render.
  const enabledKey = enabled.join(",");
  const walletsKey = JSON.stringify(wallets);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const list = enabledKey.split(",").filter(Boolean) as PaymentMethod[];
      const config = JSON.parse(walletsKey) as WalletClientConfig;
      const available: PaymentMethod[] = [];
      const outcome: Record<PaymentMethod, WalletUnavailableReason> = {
        [PaymentMethod.CARD]: "AVAILABLE",
        [PaymentMethod.APPLE_PAY]: "NOT_ENABLED",
        [PaymentMethod.GOOGLE_PAY]: "NOT_ENABLED",
      };

      if (list.includes(PaymentMethod.APPLE_PAY) && config.applePay) {
        outcome[PaymentMethod.APPLE_PAY] = await applePayAvailability(config.applePay);
        if (outcome[PaymentMethod.APPLE_PAY] === "AVAILABLE") {
          available.push(PaymentMethod.APPLE_PAY);
        }
      }
      if (list.includes(PaymentMethod.GOOGLE_PAY) && config.googlePay) {
        outcome[PaymentMethod.GOOGLE_PAY] = await googlePayAvailability(config.googlePay);
        if (outcome[PaymentMethod.GOOGLE_PAY] === "AVAILABLE") {
          available.push(PaymentMethod.GOOGLE_PAY);
        }
      }
      // Card is the fallback that must always remain reachable.
      if (list.includes(PaymentMethod.CARD)) {
        available.push(PaymentMethod.CARD);
      }

      if (!cancelled) {
        setMethods(available.length > 0 ? available : [PaymentMethod.CARD]);
        setReasons(outcome);
        setResolved(true);
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [enabledKey, walletsKey]);

  return { methods, resolved, reasons };
}
