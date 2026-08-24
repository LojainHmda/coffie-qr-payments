"use client";

import { useEffect, useState } from "react";

import { PaymentMethod } from "@/lib/payments/payment";

/**
 * Which payment methods to actually put on screen.
 *
 * Two gates, both of which must pass:
 *
 *   1. the merchant gate — does AFS have this method provisioned on our
 *      entity? Decided on the server (lib/payments/methods.ts) and handed in
 *      as `enabled`. Today that is CARD only, measured against the live TEST
 *      entity, so no wallet script below ever loads.
 *
 *   2. the device gate — can THIS browser really complete it? Checked here
 *      with the vendors' own availability APIs, never with user-agent
 *      sniffing and never assumed.
 *
 * A button appears only when both say yes. That is the whole point: a wallet
 * button that cannot complete a payment is worse than no wallet button.
 */

const GOOGLE_PAY_SDK = "https://pay.google.com/gp/p/js/pay.js";

interface GooglePayClient {
  isReadyToPay(request: unknown): Promise<{ result: boolean }>;
}

declare global {
  interface Window {
    ApplePaySession?: { canMakePayments(): boolean; supportsVersion(v: number): boolean };
    google?: {
      payments?: {
        api?: { PaymentsClient: new (options: { environment: string }) => GooglePayClient };
      };
    };
  }
}

/** Apple's own check. False on every non-WebKit browser and over plain http. */
function applePayAvailable(): boolean {
  if (!window.isSecureContext) return false;
  const session = window.ApplePaySession;
  if (!session) return false;
  try {
    return session.supportsVersion(3) && session.canMakePayments();
  } catch {
    return false;
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
async function googlePayAvailable(): Promise<boolean> {
  if (!window.isSecureContext) return false;
  try {
    await loadScript(GOOGLE_PAY_SDK);
    const api = window.google?.payments?.api;
    if (!api) return false;
    const client = new api.PaymentsClient({ environment: "TEST" });
    const response = await client.isReadyToPay({
      apiVersion: 2,
      apiVersionMinor: 0,
      allowedPaymentMethods: [
        {
          type: "CARD",
          parameters: {
            allowedAuthMethods: ["PAN_ONLY", "CRYPTOGRAM_3DS"],
            allowedCardNetworks: ["VISA", "MASTERCARD"],
          },
        },
      ],
    });
    return response.result === true;
  } catch {
    return false;
  }
}

/**
 * Resolves the merchant-enabled list against this device. Starts as CARD only
 * so the page is usable on first paint and never flashes a wallet button that
 * then disappears.
 */
export function useAvailablePaymentMethods(enabled: PaymentMethod[]): {
  methods: PaymentMethod[];
  resolved: boolean;
} {
  const [methods, setMethods] = useState<PaymentMethod[]>([PaymentMethod.CARD]);
  const [resolved, setResolved] = useState(false);

  // `enabled` is server-rendered and stable for the life of the page; joining
  // it keeps the effect from re-running on every render.
  const enabledKey = enabled.join(",");

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      const list = enabledKey.split(",").filter(Boolean) as PaymentMethod[];
      const available: PaymentMethod[] = [];

      if (list.includes(PaymentMethod.APPLE_PAY) && applePayAvailable()) {
        available.push(PaymentMethod.APPLE_PAY);
      }
      if (list.includes(PaymentMethod.GOOGLE_PAY) && (await googlePayAvailable())) {
        available.push(PaymentMethod.GOOGLE_PAY);
      }
      // Card is the fallback that must always remain reachable.
      if (list.includes(PaymentMethod.CARD)) {
        available.push(PaymentMethod.CARD);
      }

      if (!cancelled) {
        setMethods(available.length > 0 ? available : [PaymentMethod.CARD]);
        setResolved(true);
      }
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [enabledKey]);

  return { methods, resolved };
}
