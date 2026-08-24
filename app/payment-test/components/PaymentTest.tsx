"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Card, CardSubtitle, CardTitle, DetailRow } from "@/components/ui/Card";

/**
 * POC payment page.
 *
 * The card form is rendered entirely by the AFS Copy&Pay widget inside the
 * `form.paymentWidgets` element below. This component never sees, holds or
 * transmits card data: it only asks our backend for a checkout id and lets
 * the AFS script take over from there.
 */

interface CheckoutResponse {
  checkoutId: string;
  amount: string;
  currency: string;
  widgetScriptUrl: string;
  integrity: string | null;
  shopperResultUrl: string;
  brands: string;
}

interface ErrorResponse {
  error?: string;
  problems?: string[];
  debug?: unknown;
}

declare global {
  interface Window {
    wpwlOptions?: Record<string, unknown>;
  }
}

const SCRIPT_MARKER = "data-afs-widget";

type Phase = "idle" | "creating" | "widget" | "error";

export function PaymentTest({ amount, currency, product, machineId }: {
  amount: string;
  currency: string;
  product: string;
  machineId: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  const startPayment = useCallback(async () => {
    setPhase("creating");
    setError(null);
    try {
      const response = await fetch("/api/v1/payments/afs/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId }),
      });

      const body = (await response.json()) as CheckoutResponse & ErrorResponse;

      if (!response.ok) {
        const detail = body.problems?.length ? ` (${body.problems.join("; ")})` : "";
        throw new Error(`${body.error ?? "Could not start the payment."}${detail}`);
      }
      if (!body.checkoutId) {
        throw new Error("The payment gateway did not return a checkout id.");
      }

      setCheckout(body);
      setPhase("widget");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the payment.");
      setPhase("error");
    }
  }, [machineId]);

  // Load the AFS widget script exactly once per checkout, after the
  // `form.paymentWidgets` element exists in the DOM for the script to find.
  //
  // Deliberately no teardown. The AFS script installs global state
  // (window.wpwl, a hidden iframe, a second injected script) that cannot be
  // unwound by removing the tag, and React runs effects twice in development.
  // Removing and re-adding the tag would start a second widget against the
  // same page. Starting a different checkout does a full page load instead,
  // which is the only reliable way to clear the AFS globals.
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
      setError("The AFS payment form could not be loaded. Check your connection and try again.");
      setPhase("error");
    };

    document.body.appendChild(script);
    scriptRef.current = script;
  }, [checkout]);

  /**
   * Full page load, not a React state reset: once the AFS widget has
   * initialised for one checkout id, its globals must not be reused for the
   * next one, or the form can submit against a dead checkout.
   */
  const reset = () => {
    window.location.reload();
  };

  return (
    <Card>
      <CardTitle>AFS Payment Gateway Test</CardTitle>
      <CardSubtitle>Coffee Machine Demo — AFS TEST environment</CardSubtitle>

      <div className="mt-5">
        <DetailRow label="Machine" value={machineId} />
        <DetailRow label="Test product" value={product} />
        <DetailRow label="Amount" value={`${currency} ${amount}`} />
      </div>

      {phase === "idle" || phase === "creating" ? (
        <div className="mt-6">
          <Button onClick={startPayment} disabled={phase === "creating"}>
            {phase === "creating" ? "Starting payment…" : "Start Payment"}
          </Button>
        </div>
      ) : null}

      {phase === "error" ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
            {error}
          </p>
          <Button onClick={reset}>Try Again</Button>
        </div>
      ) : null}

      {phase === "widget" && checkout ? (
        <div className="mt-6">
          <p className="mb-3 text-xs text-black/50 dark:text-white/50">
            Card details are collected by AFS. Use an AFS test card only.
          </p>
          {/* Rendered and controlled by paymentWidgets.js. */}
          <form
            action={checkout.shopperResultUrl}
            className="paymentWidgets"
            data-brands={checkout.brands}
          />
          <button
            type="button"
            onClick={reset}
            className="mt-4 w-full text-center text-xs text-black/50 underline underline-offset-4 dark:text-white/50"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </Card>
  );
}
