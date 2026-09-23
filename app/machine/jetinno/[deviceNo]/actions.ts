"use server";

import { headers } from "next/headers";

import { isJetinnoConfigured } from "@/lib/jetinno/config";
import { JetinnoPayStatus } from "@/lib/jetinno/protocol";
import {
  getSlot,
  readInbox,
  reportProductDone,
  requestQrCode,
  type MachineOrder,
} from "@/lib/jetinno/simulator";
import { logPaymentError } from "@/lib/payments/log";

/**
 * Server actions for the Jetinno machine simulator.
 *
 * These run as the MACHINE, not as our server. The apikey lives here for the
 * same reason a machine's API key lives in its firmware and not in a browser:
 * the screen is a web page, and anything it holds is public.
 *
 * A server action is a public endpoint, so every argument is validated as if a
 * stranger sent it — because one can.
 */

export type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const DEVICE_NO = /^[A-Za-z0-9-]{1,32}$/;
const ORDER_NO = /^[A-Za-z0-9]{1,64}$/;

/**
 * Where this machine believes the server lives.
 *
 * Taken from the request that rendered the screen, so opening the page at a
 * LAN address makes the machine talk to that address AND hand over a callback
 * address on it. Open it at localhost and both stay on localhost.
 */
async function serverBaseUrl(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) throw new Error("Cannot determine this server's address.");
  return `${proto}://${host}`;
}

function failure(event: string, error: unknown): { ok: false; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  logPaymentError(event, { message });
  return { ok: false, error: message };
}

export interface TerminalMachineOrder {
  orderNo: string;
  productId: string;
  productName: string;
  latinName: string;
  priceMinor: number;
  /** The raw §3.1.3 string, shown on screen because that IS the demonstration. */
  qrCode: string;
  qrSvg: string;
}

function view(order: MachineOrder): TerminalMachineOrder {
  return {
    orderNo: order.orderNo,
    productId: order.slot.productId,
    productName: order.slot.productName,
    latinName: order.slot.latinName,
    priceMinor: order.priceMinor,
    qrCode: order.qrCode,
    qrSvg: order.qrSvg,
  };
}

/** §3.1 — the machine prices a slot and asks our server for a QR string. */
export async function machineRequestQr(
  deviceNo: unknown,
  productId: unknown,
): Promise<ActionResult<TerminalMachineOrder>> {
  try {
    if (typeof deviceNo !== "string" || !DEVICE_NO.test(deviceNo)) {
      return { ok: false, error: "Invalid device number." };
    }
    if (typeof productId !== "string" || !getSlot(productId)) {
      return { ok: false, error: "That slot is empty." };
    }
    if (!isJetinnoConfigured()) {
      return {
        ok: false,
        error:
          "Jetinno credentials are not configured. Set JETINNO_USERNAME and JETINNO_APIKEY, then restart.",
      };
    }

    const order = await requestQrCode({
      baseUrl: await serverBaseUrl(),
      deviceNo,
      productId,
    });

    return { ok: true, data: view(order) };
  } catch (error) {
    return failure("jetinno.sim.getQrCode.failed", error);
  }
}

export interface CallbackView {
  received: boolean;
  payStatus: string | null;
  platBillNo: string | null;
  receivedAt: string | null;
  reportedDoneAt: string | null;
}

/**
 * What this machine has been told, if anything.
 *
 * The screen waits on this rather than on our order table, because a real
 * machine has no access to our database. Its only channel is the callback.
 */
export async function machineReadCallback(orderNo: unknown): Promise<ActionResult<CallbackView>> {
  try {
    if (typeof orderNo !== "string" || !ORDER_NO.test(orderNo)) {
      return { ok: false, error: "Invalid order number." };
    }

    const entry = readInbox(orderNo);
    return {
      ok: true,
      data: {
        received: Boolean(entry),
        payStatus: entry?.payStatus ?? null,
        platBillNo: entry?.platBillNo ?? null,
        receivedAt: entry?.receivedAt ?? null,
        reportedDoneAt: entry?.reportedDoneAt ?? null,
      },
    };
  } catch (error) {
    return failure("jetinno.sim.callback.read_failed", error);
  }
}

/** §3.5 — the machine reporting whether the drink actually came out. */
export async function machineReportDone(
  deviceNo: unknown,
  productId: unknown,
  orderNo: unknown,
  isFinish: unknown,
): Promise<ActionResult<{ returnCode: string; msg: string }>> {
  try {
    if (typeof deviceNo !== "string" || !DEVICE_NO.test(deviceNo)) {
      return { ok: false, error: "Invalid device number." };
    }
    if (typeof orderNo !== "string" || !ORDER_NO.test(orderNo)) {
      return { ok: false, error: "Invalid order number." };
    }
    const slot = typeof productId === "string" ? getSlot(productId) : undefined;
    if (!slot) return { ok: false, error: "That slot is empty." };
    if (isFinish !== "SUCCESS" && isFinish !== "ERROR") {
      return { ok: false, error: "isFinish must be SUCCESS or ERROR." };
    }

    // A machine only reports on an order it was actually paid for.
    const entry = readInbox(orderNo);
    if (entry?.payStatus !== JetinnoPayStatus.PAYSUCCESS) {
      return { ok: false, error: "This machine has not been told the order was paid." };
    }

    const result = await reportProductDone({
      baseUrl: await serverBaseUrl(),
      deviceNo,
      productId: slot.productId,
      orderNo,
      orderAmountMinor: slot.priceMinor,
      isFinish,
    });

    return { ok: true, data: result };
  } catch (error) {
    return failure("jetinno.sim.productdone.failed", error);
  }
}
