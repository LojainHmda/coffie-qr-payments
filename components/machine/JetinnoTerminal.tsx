"use client";

import { useCallback, useEffect, useState } from "react";

import {
  machineReadCallback,
  machineReportDone,
  machineRequestQr,
  type TerminalMachineOrder,
} from "@/app/machine/jetinno/[deviceNo]/actions";
import type { Slot } from "@/lib/jetinno/simulator";

/**
 * A Jetinno machine's screen, driven by the real IOT protocol.
 *
 * Every difference from the other terminal is a difference in the protocol,
 * not in taste:
 *
 *   - one drink per order, because §3.1.2 carries a single productId and a
 *     single orderAmount, with no quantity field anywhere;
 *   - the price comes from the machine's own slot list, not from our
 *     catalogue, because the machine is what states it;
 *   - the screen waits on the §3.3 callback rather than polling our order
 *     table, because a real machine has no access to that table;
 *   - the drink is poured only after the callback says PAYSUCCESS, and the
 *     machine then reports §3.5 — the one step that tells the server whether
 *     coffee actually came out.
 */

const POLL_INTERVAL_MS = 2000;

type Stage = "browsing" | "requesting" | "awaiting" | "pouring" | "done" | "failed";

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function JetinnoTerminal({
  deviceNo,
  slots,
  configured,
}: {
  deviceNo: string;
  slots: Slot[];
  configured: boolean;
}) {
  const [stage, setStage] = useState<Stage>("browsing");
  const [order, setOrder] = useState<TerminalMachineOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [platBillNo, setPlatBillNo] = useState<string | null>(null);
  const [doneReport, setDoneReport] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStage("browsing");
    setOrder(null);
    setError(null);
    setPlatBillNo(null);
    setDoneReport(null);
  }, []);

  const choose = async (productId: string) => {
    setStage("requesting");
    setError(null);

    const result = await machineRequestQr(deviceNo, productId);
    if (!result.ok) {
      setError(result.error);
      setStage("browsing");
      return;
    }
    setOrder(result.data);
    setStage("awaiting");
  };

  // Wait for the callback. This is the machine's only channel — it cannot see
  // our orders, only what it has been told.
  useEffect(() => {
    if (stage !== "awaiting" || !order) return;

    let cancelled = false;

    const tick = async () => {
      const result = await machineReadCallback(order.orderNo);
      if (cancelled || !result.ok || !result.data.received) return;

      setPlatBillNo(result.data.platBillNo);
      setStage(result.data.payStatus === "PAYSUCCESS" ? "pouring" : "failed");
    };

    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stage, order]);

  // Pour, then report §3.5. The delay stands in for the time a real machine
  // spends grinding and brewing.
  useEffect(() => {
    if (stage !== "pouring" || !order) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await machineReportDone(deviceNo, order.productId, order.orderNo, "SUCCESS");
      if (cancelled) return;
      setDoneReport(result.ok ? `${result.data.returnCode} · ${result.data.msg}` : result.error);
      setStage("done");
    }, 2500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stage, order, deviceNo]);

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
          <p className="truncate text-sm font-semibold tracking-tight">Jetinno · {deviceNo}</p>
          <p className="truncate text-xs text-black/50 dark:text-white/50">
            IOT Payment Universal Interface
          </p>
        </div>
      </header>

      {!configured ? (
        <p className="mb-4 rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          Jetinno credentials are not configured, so every request will be refused — which is the
          intended behaviour, not a fault. Set <code className="font-mono">JETINNO_USERNAME</code>{" "}
          and <code className="font-mono">JETINNO_APIKEY</code> and restart the server.
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </p>
      ) : null}

      {stage === "browsing" || stage === "requesting" ? (
        <section className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <h1 className="text-lg font-semibold tracking-tight">请选择饮品</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Choose a drink. One drink per order — the protocol carries a single product and a single
            amount.
          </p>

          <ul className="mt-4 space-y-2">
            {slots.map((slot) => (
              <li key={slot.productId}>
                <button
                  type="button"
                  onClick={() => void choose(slot.productId)}
                  disabled={stage === "requesting"}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-black/10 px-4 py-3 text-left transition-opacity active:opacity-70 disabled:opacity-40 dark:border-white/15"
                >
                  <div className="min-w-0">
                    <p className="truncate text-base font-medium">{slot.productName}</p>
                    <p className="text-xs text-black/50 dark:text-white/50">
                      {slot.latinName} · slot {slot.productId}
                    </p>
                  </div>
                  <span className="shrink-0 text-base font-semibold tabular-nums">
                    AED {money(slot.priceMinor)}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[11px] leading-relaxed text-black/45 dark:text-white/45">
            These prices live on the machine, not on the server. §3.1.2 sends{" "}
            <code className="font-mono">orderAmount</code> in cents and leaves the server no field
            in which to answer with a different one.
          </p>

          {stage === "requesting" ? (
            <p className="mt-3 text-sm text-black/60 dark:text-white/60">
              Calling <code className="font-mono">getQrCode</code>…
            </p>
          ) : null}
        </section>
      ) : null}

      {stage === "awaiting" && order ? (
        <section className="rounded-2xl border border-black/10 bg-white p-5 text-center shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <p className="text-xs tracking-wide text-black/50 uppercase dark:text-white/50">
            {order.orderNo}
          </p>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">扫码支付 · Scan to pay</h1>
          <p className="mt-1 text-3xl font-semibold tabular-nums">AED {money(order.priceMinor)}</p>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {order.productName} · {order.latinName}
          </p>

          <div
            className="mx-auto mt-4 w-full max-w-[260px] rounded-xl bg-white p-3 [&>svg]:h-auto [&>svg]:w-full"
            // Drawn BY THE MACHINE from the string the server returned. Our
            // server sent 128 characters of text and no image at all.
            dangerouslySetInnerHTML={{ __html: order.qrSvg }}
          />

          <p className="mt-4 text-left text-[11px] leading-relaxed text-black/45 dark:text-white/45">
            The server returned this string, {order.qrCode.length} of 128 characters allowed:
            <code className="mt-1 block font-mono break-all text-black/70 dark:text-white/70">
              {order.qrCode}
            </code>
          </p>

          <p className="mt-4 text-sm text-black/60 dark:text-white/60">
            Waiting for the payment callback…
          </p>
          <p className="mt-1 text-[11px] text-black/45 dark:text-white/45">
            This machine cannot see the order. It waits to be told, on the address it supplied.
          </p>

          <button
            type="button"
            onClick={reset}
            className="mt-4 w-full py-2 text-xs text-black/50 underline underline-offset-4 dark:text-white/50"
          >
            Cancel and start over
          </button>
        </section>
      ) : null}

      {stage === "pouring" && order ? (
        <section className="rounded-2xl border border-emerald-500/30 bg-white p-6 text-center shadow-sm dark:bg-neutral-900">
          <div
            aria-hidden
            className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-500/15"
          >
            ✓
          </div>
          <h1 className="mt-4 text-xl font-semibold tracking-tight">支付成功 · PAYSUCCESS</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {order.productName} · AED {money(order.priceMinor)}
          </p>
          {platBillNo ? (
            <p className="mt-2 text-[11px] text-black/45 dark:text-white/45">
              platBillNo <code className="font-mono">{platBillNo}</code>
            </p>
          ) : null}
          <p className="mt-4 text-base font-medium">正在出品 · Pouring…</p>
        </section>
      ) : null}

      {stage === "done" && order ? (
        <section className="rounded-2xl border border-black/10 bg-white p-6 text-center shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <h1 className="text-xl font-semibold tracking-tight">请取饮品 · Please take your drink</h1>
          <p className="mt-3 text-sm text-black/60 dark:text-white/60">
            Reported <code className="font-mono">productdone</code> with{" "}
            <code className="font-mono">isFinish: SUCCESS</code>
          </p>
          {doneReport ? (
            <p className="mt-1 text-[11px] text-black/45 dark:text-white/45">{doneReport}</p>
          ) : null}
          <button
            type="button"
            onClick={reset}
            className="mt-5 min-h-14 w-full rounded-xl bg-black text-base font-medium text-white dark:bg-white dark:text-black"
          >
            Done
          </button>
        </section>
      ) : null}

      {stage === "failed" && order ? (
        <section className="rounded-2xl border border-red-500/30 bg-white p-6 text-center shadow-sm dark:bg-neutral-900">
          <h1 className="text-xl font-semibold tracking-tight">支付失败 · PAYERROR</h1>
          <p className="mt-2 text-sm text-black/60 dark:text-white/60">
            No drink is poured and nothing was charged.
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-5 min-h-14 w-full rounded-xl bg-black text-base font-medium text-white dark:bg-white dark:text-black"
          >
            Start again
          </button>
        </section>
      ) : null}
    </div>
  );
}
