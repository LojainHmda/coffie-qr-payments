"use client";

import { useCallback, useEffect, useState } from "react";

import { PAYMENT_METHOD_LABEL, PaymentMethod } from "@/lib/payments/payment";
import { useAvailablePaymentMethods } from "./useAvailablePaymentMethods";

/**
 * Customer payment step.
 *
 * Card details are collected entirely by the AFS Copy&Pay widget inside the
 * `form.paymentWidgets` element. This component never sees, holds or transmits
 * card data: it asks our backend for an order and a checkout id, then lets the
 * AFS script take over.
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

export function PayCheckout({
  machineToken,
  productId,
  productName,
  price,
  currency,
  enabledMethods,
}: {
  machineToken: string;
  productId: string;
  productName: string;
  /** Display only. The server reads the real price from the catalogue. */
  price: string;
  currency: string;
  enabledMethods: PaymentMethod[];
}) {
  const [phase, setPhase] = useState<Phase>("choosing");
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { methods, resolved } = useAvailablePaymentMethods(enabledMethods);

  const pay = useCallback(
    async (method: PaymentMethod) => {
      setPhase("starting");
      setError(null);
      try {
        // 1. The server builds the order and decides the amount from the
        //    catalogue. We send only which machine and which product.
        const orderResponse = await fetch("/api/v1/orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, productId }),
        });
        const order = (await orderResponse.json()) as { orderId?: string } & ErrorResponse;
        if (!orderResponse.ok || !order.orderId) {
          throw new Error(order.error ?? "Could not start your order.");
        }

        // 2. The server creates the AFS checkout for that order.
        const checkoutResponse = await fetch("/api/v1/payments/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ machineToken, orderId: order.orderId, method }),
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
    [machineToken, productId],
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

    window.wpwlOptions = { locale: "en", style: "card" };

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
  }, [checkout]);

  /** Full page load, not a state reset: the AFS globals must not be reused. */
  const startOver = () => window.location.reload();

  return (
    <>
      <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
        <p className="text-xs tracking-wide text-black/50 uppercase dark:text-white/50">You are buying</p>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">{productName}</h1>
          <p className="shrink-0 text-2xl font-semibold tabular-nums">
            {currency} {price}
          </p>
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

          {resolved && methods.length === 1 && methods[0] === PaymentMethod.CARD ? (
            <p className="mt-4 text-xs leading-relaxed text-black/45 dark:text-white/45">
              Apple Pay and Google Pay are not available for this merchant account yet, so card is
              the only option. Nothing is hidden from you — a wallet button appears here as soon as
              AFS enables it and your device supports it.
            </p>
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
            Order #{checkout.orderNumber} · paying with {PAYMENT_METHOD_LABEL[checkout.method]}. Your
            card details go straight to AFS.
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
