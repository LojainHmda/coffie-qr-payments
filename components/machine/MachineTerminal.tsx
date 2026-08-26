"use client";

import { useCallback, useEffect, useState } from "react";

import {
  createTerminalOrder,
  readTerminalOrder,
  type TerminalOrder,
} from "@/app/machine/[code]/actions";
import type { Product } from "@/lib/catalog/products";
import { OrderStatus } from "@/lib/orders/order";

/**
 * The coffee machine's screen, standing in for hardware that does not exist
 * yet.
 *
 * It is the ONLY place a drink is chosen. The customer builds a basket here,
 * the machine asks the server to price it, and the server hands back a QR for
 * that one order. The customer's phone then does nothing but pay.
 *
 * Nothing on this screen decides whether a drink is poured. The machine polls
 * its own order and waits for `dispense`, which the server sets only after it
 * has verified the payment with AFS itself.
 */

const POLL_INTERVAL_MS = 2000;

type Stage = "browsing" | "ringing" | "awaiting" | "dispensing" | "expired";

interface Basket {
  [productId: string]: number;
}

export function MachineTerminal({
  machineCode,
  machineLocation,
  products,
}: {
  machineCode: string;
  machineLocation: string;
  products: Product[];
}) {
  const [basket, setBasket] = useState<Basket>({});
  const [stage, setStage] = useState<Stage>("browsing");
  const [order, setOrder] = useState<TerminalOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const lines = Object.entries(basket)
    .filter(([, quantity]) => quantity > 0)
    .map(([productId, quantity]) => ({ productId, quantity }));

  const basketCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  const adjust = (productId: string, delta: number) => {
    setBasket((current) => {
      const next = Math.max(0, Math.min(20, (current[productId] ?? 0) + delta));
      return { ...current, [productId]: next };
    });
  };

  const reset = useCallback(() => {
    setBasket({});
    setOrder(null);
    setError(null);
    setSecondsLeft(null);
    setStage("browsing");
  }, []);

  const checkout = async () => {
    setStage("ringing");
    setError(null);
    const result = await createTerminalOrder(machineCode, lines);
    if (!result.ok) {
      setError(result.error);
      setStage("browsing");
      return;
    }
    setOrder(result.data);
    setStage("awaiting");
  };

  // Poll the server while the QR is on screen. The interval is cleared as soon
  // as the order leaves the waiting state, so a dispensed or expired order
  // stops generating traffic.

  useEffect(() => {
    if (stage !== "awaiting" || !order) return;

    let cancelled = false;

    const tick = async () => {
      const result = await readTerminalOrder(machineCode, order.orderId);
      if (cancelled) return;

      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.data.dispense) {
        setStage("dispensing");
        return;
      }
      if (result.data.status === OrderStatus.CANCELLED) {
        setError("The payment was cancelled.");
      }
    };

    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stage, order, machineCode]);

  // Countdown to the pay window closing. When it runs out the QR is dead, so
  // the screen says so instead of leaving a code that silently stops working.
  useEffect(() => {
    if (stage !== "awaiting" || !order) return;

    const update = () => {
      const remaining = Math.round((Date.parse(order.expiresAt) - Date.now()) / 1000);
      setSecondsLeft(remaining);
      if (remaining <= 0) setStage("expired");
    };

    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [stage, order]);

  return (
    <div className="mx-auto w-full max-w-lg">
      <header className="mb-4 flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-xl text-white dark:bg-white dark:text-neutral-900"
        >
          ☕
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight">{machineCode}</p>
          <p className="truncate text-xs text-black/50 dark:text-white/50">{machineLocation}</p>
        </div>
      </header>

      {error ? (
        <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {stage === "browsing" || stage === "ringing" ? (
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <h1 className="text-lg font-semibold tracking-tight">Choose your drinks</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Pick what you want, then tap Checkout for a code to scan.
          </p>

          <ul className="mt-4 space-y-2">
            {products.map((product) => {
              const quantity = basket[product.id] ?? 0;
              return (
                <li
                  key={product.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium">{product.name}</p>
                    <p className="text-xs text-black/50 dark:text-white/50">
                      {product.currency} {product.price}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StepperButton
                      label={`Remove one ${product.name}`}
                      onClick={() => adjust(product.id, -1)}
                      disabled={quantity === 0 || stage === "ringing"}
                    >
                      −
                    </StepperButton>
                    <span className="w-6 text-center text-base font-semibold tabular-nums">
                      {quantity}
                    </span>
                    <StepperButton
                      label={`Add one ${product.name}`}
                      onClick={() => adjust(product.id, 1)}
                      disabled={stage === "ringing"}
                    >
                      +
                    </StepperButton>
                  </div>
                </li>
              );
            })}
          </ul>

          <button
            type="button"
            onClick={checkout}
            disabled={basketCount === 0 || stage === "ringing"}
            className="mt-5 min-h-14 w-full rounded-xl bg-black text-base font-medium text-white transition-opacity active:opacity-80 disabled:opacity-40 dark:bg-white dark:text-black"
          >
            {stage === "ringing"
              ? "Ringing up…"
              : basketCount === 0
                ? "Choose a drink"
                : `Checkout · ${basketCount} item${basketCount === 1 ? "" : "s"}`}
          </button>
        </section>
      ) : null}

      {stage === "awaiting" && order ? (
        <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <p className="text-xs tracking-wide text-black/50 uppercase dark:text-white/50">
            Order #{order.orderNumber}
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Scan to pay</h1>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {order.currency} {order.total}
          </p>

          <div
            className="mx-auto mt-4 w-full max-w-[260px] rounded-xl bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
            // Generated on the server by the qrcode package from our own URL.
            dangerouslySetInnerHTML={{ __html: order.qrSvg }}
          />

          <ul className="mt-4 space-y-1 text-left text-sm">
            {order.items.map((item) => (
              <li key={item.productId} className="flex justify-between gap-4">
                <span>
                  {item.productName}
                  {item.quantity > 1 ? ` × ${item.quantity}` : ""}
                </span>
                <span className="tabular-nums">{item.totalPrice}</span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-sm text-black/60 dark:text-white/60">
            Waiting for payment
            {secondsLeft !== null && secondsLeft > 0 ? ` · ${formatCountdown(secondsLeft)} left` : ""}
          </p>

          {order.qrUnreachable ? (
            <p className="mt-3 rounded-xl bg-amber-50 p-3 text-left text-xs leading-relaxed text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
              This code points at <code className="font-mono">{order.payUrl}</code>, which a phone
              cannot reach. Open this page at your computer&rsquo;s LAN address — for example{" "}
              <code className="font-mono">http://192.168.1.45:3000/machine/{machineCode}</code> —
              and the next code will carry an address the phone can open.
            </p>
          ) : null}

          <button
            type="button"
            onClick={reset}
            className="mt-4 w-full py-2 text-xs text-black/50 underline underline-offset-4 dark:text-white/50"
          >
            Cancel and start over
          </button>
        </section>
      ) : null}

      {stage === "dispensing" && order ? (
        <section className="rounded-2xl border border-emerald-500/30 bg-white p-6 text-center shadow-sm dark:bg-neutral-900">
          <div
            aria-hidden
            className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-500/15"
          >
            ✓
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">Payment received</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Order #{order.orderNumber} · {order.currency} {order.total}
          </p>
          <p className="mt-4 text-base font-medium">Dispensing your drink…</p>
          <p className="mt-2 text-xs text-black/45 dark:text-white/45">
            A real machine would pour here. This POC has no hardware integration.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 min-h-14 w-full rounded-xl bg-black text-base font-medium text-white dark:bg-white dark:text-black"
          >
            Done
          </button>
        </section>
      ) : null}

      {stage === "expired" && order ? (
        <section className="rounded-2xl border border-black/10 bg-white p-6 text-center shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <h1 className="text-lg font-semibold tracking-tight">Code expired</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Order #{order.orderNumber} was not paid in time. Nothing was charged.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 min-h-14 w-full rounded-xl bg-black text-base font-medium text-white dark:bg-white dark:text-black"
          >
            Start over
          </button>
        </section>
      ) : null}
    </div>
  );
}

function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function StepperButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-10 items-center justify-center rounded-lg border border-black/15 text-lg font-medium transition-colors active:bg-black/5 disabled:opacity-30 dark:border-white/20 dark:active:bg-white/10"
    >
      {children}
    </button>
  );
}
