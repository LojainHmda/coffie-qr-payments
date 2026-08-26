"use client";

import { useCallback, useEffect, useState } from "react";

import type { OrderItem } from "@/lib/orders/order";
import { PAYMENT_METHOD_LABEL, PaymentMethod } from "@/lib/payments/payment";
import type { WalletClientConfig } from "@/lib/payments/wallets";
import { useAvailablePaymentMethods, type WalletUnavailableReason } from "./useAvailablePaymentMethods";
import { buildWpwlOptions } from "./wpwlOptions";

/**
 * Customer payment step.
 *
 * The order already exists: the customer built it on the machine, the machine
 * asked our server to price it, and the QR they scanned carries that order's
 * pay token. So this component creates nothing — it shows what is owed and
 * starts a checkout for it.
 *
 * Card details are collected entirely by the AFS Copy&Pay widget inside the
 * `form.paymentWidgets` element. This component never sees, holds or transmits
 * card data.
 */

interface CheckoutResponse {
  checkoutId: string;
  orderId: string;
  orderNumber: number;
  amount: string;
  currency: string;
  method: PaymentMethod;
  widgetScriptUrl: string;
  integrity: string | null;
  shopperResultUrl: string;
  brands: string;
}

interface ErrorResponse {
  error?: string;
  problems?: string[];
}

declare global {
  interface Window {
    wpwlOptions?: Record<string, unknown>;
  }
}

const SCRIPT_MARKER = "data-afs-widget";

type Phase = "choosing" | "starting" | "widget" | "error";

/** Icon + wording per method. Wallet entries are only ever reached when the
 *  method actually resolved as available on this device. */
const METHOD_PRESENTATION: Record<PaymentMethod, { icon: string; label: string; primary: boolean }> = {
  APPLE_PAY: { icon: "", label: "Pay with Apple Pay", primary: true },
  GOOGLE_PAY: { icon: "G", label: "Pay with Google Pay", primary: true },
  CARD: { icon: "💳", label: "Pay with Card", primary: false },
};

/**
 * One honest sentence per missing wallet. A button that is not there is
 * explained rather than left as a silent gap the customer has to guess about.
 */
function walletNote(method: PaymentMethod, reason: WalletUnavailableReason): string | null {
  const label = PAYMENT_METHOD_LABEL[method];
  switch (reason) {
    case "NOT_ENABLED":
      return `${label} is not enabled on this merchant account yet.`;
    case "INSECURE_CONTEXT":
      return `${label} needs a secure https connection, so it cannot appear on this address.`;
    case "NO_CARD":
      return `${label} is set up on this device but has no card that can pay on the web.`;
    case "UNSUPPORTED_DEVICE":
      return `${label} is not supported by this browser or device.`;
    default:
      return null;
  }
}

export interface PayOrderSummary {
  orderNumber: number;
  items: OrderItem[];
  /** Display only. The server re-reads the real total from the order. */
  total: string;
  currency: string;
}

export function PayCheckout({
  payToken,
  order,
  enabledMethods,
  wallets,
}: {
  payToken: string;
  order: PayOrderSummary;
  enabledMethods: PaymentMethod[];
  /** Apple Pay / Google Pay widget configuration, built server-side. */
  wallets: WalletClientConfig;
}) {
  const [phase, setPhase] = useState<Phase>("choosing");
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { methods, resolved, reasons } = useAvailablePaymentMethods(enabledMethods, wallets);

  const pay = useCallback(
    async (method: PaymentMethod) => {
      setPhase("starting");
      setError(null);
      try {
        // One request, and it names neither a price nor a product: the token
        // resolves server-side to the order the machine already priced.
        const checkoutResponse = await fetch("/api/v1/payments/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payToken, method }),
        });
        const body = (await checkoutResponse.json()) as CheckoutResponse & ErrorResponse;
        if (!checkoutResponse.ok || !body.checkoutId) {
          const detail = body.problems?.length ? ` (${body.problems.join("; ")})` : "";
          throw new Error(`${body.error ?? "Could not start the payment."}${detail}`);
        }

        setCheckout(body);
        setPhase("widget");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not start the payment.");
        setPhase("error");
      }
    },
    [payToken],
  );

  // Load the AFS widget script exactly once per checkout, after the
  // `form.paymentWidgets` element exists in the DOM for the script to find.
  //
  // Deliberately no teardown. The AFS script installs global state
  // (window.wpwl, a hidden iframe, a second injected script) that cannot be
  // unwound by removing the tag, and React runs effects twice in development.
  // Starting a different checkout does a full page load instead, which is the
  // only reliable way to clear the AFS globals.
  useEffect(() => {
    if (!checkout) return;
    if (document.querySelector(`script[${SCRIPT_MARKER}]`)) return;

    // Must be set BEFORE the widget script loads: the widget reads this global
    // once at boot. For a wallet it carries the payment-sheet configuration —
    // Apple's total and supportedNetworks, Google's mandatory
    // gatewayMerchantId — without which the button either never renders or
    // renders and then fails when tapped.
    //
    // The amount and currency come from the checkout the server created, not
    // from the total this page rendered, so the Apple Pay sheet shows exactly
    // what AFS will charge.
    window.wpwlOptions = buildWpwlOptions(checkout.method, checkout, wallets, {
      // The customer dismissed the wallet sheet. Not an error: leave the form
      // in place so they can tap the button again or cancel out.
      onCancel: () => {},
    });

    const script = document.createElement("script");
    script.src = checkout.widgetScriptUrl;
    script.async = true;
    script.setAttribute(SCRIPT_MARKER, checkout.checkoutId);
    if (checkout.integrity) {
      script.integrity = checkout.integrity;
      script.crossOrigin = "anonymous";
    }
    script.onerror = () => {
      setError("The payment form could not be loaded. Check your connection and try again.");
      setPhase("error");
    };

    document.body.appendChild(script);
  }, [checkout, wallets]);

  /** Full page load, not a state reset: the AFS globals must not be reused. */
  const startOver = () => window.location.reload();

  return (
    <>
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-xs tracking-wide text-black/50 uppercase dark:text-white/50">
            Your order
          </p>
          <p className="text-xs text-black/50 dark:text-white/50">#{order.orderNumber}</p>
        </div>

        <ul className="mt-3 space-y-2">
          {order.items.map((item) => (
            <li key={item.productId} className="flex items-baseline justify-between gap-4 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{item.productName}</span>
                {item.quantity > 1 ? (
                  <span className="text-black/50 dark:text-white/50"> × {item.quantity}</span>
                ) : null}
              </span>
              <span className="shrink-0 tabular-nums">{item.totalPrice}</span>
            </li>
          ))}
        </ul>

        <div className="mt-3 flex items-baseline justify-between gap-4 border-t border-black/5 pt-3 dark:border-white/10">
          <span className="text-sm font-medium">Total</span>
          <span className="text-2xl font-semibold tabular-nums">
            {order.currency} {order.total}
          </span>
        </div>
      </div>

      {phase === "choosing" || phase === "starting" ? (
        <div className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <p className="text-sm font-medium">Choose how you want to pay</p>

          <div className="mt-4 space-y-3">
            {methods.map((method) => {
              const presentation = METHOD_PRESENTATION[method];
              return (
                <button
                  key={method}
                  type="button"
                  onClick={() => pay(method)}
                  disabled={phase === "starting"}
                  className={
                    presentation.primary
                      ? "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-black px-4 text-base font-medium text-white transition-opacity active:opacity-80 disabled:opacity-50 dark:bg-white dark:text-black"
                      : "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-black/15 px-4 text-base font-medium transition-colors active:bg-black/5 disabled:opacity-50 dark:border-white/20 dark:active:bg-white/10"
                  }
                >
                  <span aria-hidden>{presentation.icon}</span>
                  <span>{phase === "starting" ? "Starting…" : presentation.label}</span>
                </button>
              );
            })}
          </div>

          {resolved && !methods.includes(PaymentMethod.APPLE_PAY) && !methods.includes(PaymentMethod.GOOGLE_PAY) ? (
            <div className="mt-4 space-y-1 text-xs leading-relaxed text-black/45 dark:text-white/45">
              {[PaymentMethod.APPLE_PAY, PaymentMethod.GOOGLE_PAY]
                .map((method) => ({ method, note: walletNote(method, reasons[method]) }))
                .filter((entry) => entry.note !== null)
                .map((entry) => (
                  <p key={entry.method}>{entry.note}</p>
                ))}
              <p>Nothing is hidden from you — a wallet button appears here the moment it can work.</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
          <button
            type="button"
            onClick={startOver}
            className="mt-4 min-h-14 w-full rounded-xl bg-black text-base font-medium text-white dark:bg-white dark:text-black"
          >
            Try again
          </button>
        </div>
      ) : null}

      {phase === "widget" && checkout ? (
        <div className="mt-4 rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <p className="mb-3 text-xs text-black/50 dark:text-white/50">
            Paying with {PAYMENT_METHOD_LABEL[checkout.method]}.{" "}
            {checkout.method === PaymentMethod.CARD
              ? "Your card details go straight to AFS."
              : "Your card details stay in your wallet; AFS receives a one-time token."}
          </p>
          {/* Rendered and controlled by paymentWidgets.js. */}
          <form
            action={checkout.shopperResultUrl}
            className="paymentWidgets"
            data-brands={checkout.brands}
          />
          <button
            type="button"
            onClick={startOver}
            className="mt-4 w-full py-2 text-center text-xs text-black/50 underline underline-offset-4 dark:text-white/50"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </>
  );
}
