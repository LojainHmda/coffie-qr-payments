import QRCode from "qrcode";

import { shared } from "@/lib/store/memory";

import { jetinnoConfig, type JetinnoConfig } from "./config";
import { JetinnoPayType, RESPONSE_TIMEOUT_MS, type JetinnoPayStatus } from "./protocol";
import { jetinnoTimestamp, signFields } from "./signature";

/**
 * A stand-in for the Jetinno machine itself — the OTHER side of the protocol.
 *
 * Everything else under lib/jetinno is our server answering a machine. This
 * file pretends to BE the machine: it holds a slot list, prices a drink from
 * it, signs a §3.1 request, posts it to our own endpoint over real HTTP, draws
 * the returned string as a QR, waits for the §3.3 callback on its own address,
 * and finally reports §3.5.
 *
 * It calls the endpoint over the network on purpose rather than importing the
 * handler. A direct call would skip the envelope, the signature and the
 * validation — which is precisely the part worth demonstrating.
 *
 * Simulator only. None of this ships to a machine, and none of it is reachable
 * unless the Jetinno credentials are configured.
 */

/**
 * The machine's own slot list.
 *
 * Deliberately NOT lib/catalog/products.ts. A real Jetinno unit is loaded with
 * its own recipes at its own prices, and the whole point of §3.1.2 is that the
 * machine states them. Keeping this list separate — different drinks,
 * different prices, Chinese names as the specification asks for — makes it
 * visible on screen that the price came from the machine and not from us.
 */
export interface Slot {
  /** Their productId. §4.2 maps these per machine; small integers in practice. */
  productId: string;
  /** §3.1.2: "Product name, unified use of Chinese". */
  productName: string;
  latinName: string;
  /** Minor units, exactly as the machine would state it. */
  priceMinor: number;
}

export const SLOTS: readonly Slot[] = [
  { productId: "1", productName: "美式咖啡", latinName: "Americano", priceMinor: 400 },
  { productId: "2", productName: "拿铁", latinName: "Latte", priceMinor: 550 },
  { productId: "3", productName: "卡布奇诺", latinName: "Cappuccino", priceMinor: 650 },
  { productId: "4", productName: "热巧克力", latinName: "Hot Chocolate", priceMinor: 700 },
];

export function getSlot(productId: string): Slot | undefined {
  return SLOTS.find((slot) => slot.productId === productId);
}

/**
 * What this machine has been told about an order, by order number.
 *
 * On real hardware this is firmware state. Here it stands in for it, so the
 * screen can wait on a callback the way a machine does instead of polling our
 * database — which a machine has no access to.
 */
export interface MachineInboxEntry {
  orderNo: string;
  payStatus: JetinnoPayStatus;
  platBillNo: string | null;
  receivedAt: string;
  /** Set once this machine has reported §3.5 for the order. */
  reportedDoneAt: string | null;
}

const inbox = shared("jetinno.sim.inbox", () => new Map<string, MachineInboxEntry>());

export function recordCallback(entry: Omit<MachineInboxEntry, "reportedDoneAt">) {
  inbox.set(entry.orderNo, { ...entry, reportedDoneAt: null });
}

export function readInbox(orderNo: string): MachineInboxEntry | undefined {
  return inbox.get(orderNo);
}

export function markReported(orderNo: string) {
  const entry = inbox.get(orderNo);
  if (entry) inbox.set(orderNo, { ...entry, reportedDoneAt: new Date().toISOString() });
}

/** Test helper. */
export function resetSimulatorInbox() {
  inbox.clear();
}

/** Build and sign an envelope the way a machine's firmware would. */
function envelope(
  config: JetinnoConfig,
  data: Record<string, unknown>,
  exclude: readonly string[] = [],
) {
  const time = jetinnoTimestamp();
  return {
    username: config.username,
    time,
    sign: signFields({ username: config.username, time, ...data }, config.apikey, { exclude }),
    data,
  };
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RESPONSE_TIMEOUT_MS),
    cache: "no-store",
  });
  return (await response.json()) as {
    returnCode: string;
    msg: string;
    data?: Record<string, unknown>;
  };
}

export interface MachineOrder {
  orderNo: string;
  slot: Slot;
  priceMinor: number;
  /** The raw string our server returned in §3.1.3. */
  qrCode: string;
  /** That same string, drawn by the machine. This is the machine's own job. */
  qrSvg: string;
}

/**
 * The whole §3.1 exchange, from the machine's side.
 *
 * `baseUrl` is where this simulated machine believes our server lives, and is
 * also the host of the callback address it hands over. Both come from the
 * request that rendered the screen, so opening the page at a LAN address makes
 * the machine talk to — and be called back on — that same address.
 */
export async function requestQrCode(params: {
  baseUrl: string;
  deviceNo: string;
  productId: string;
}): Promise<MachineOrder> {
  const config = jetinnoConfig();

  const slot = getSlot(params.productId);
  if (!slot) throw new Error("That slot is empty.");

  // Their format: globally unique, letters and digits only.
  const orderNo = `SIM${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const data = {
    deviceNo: params.deviceNo,
    productId: slot.productId,
    productName: slot.productName,
    orderNo,
    // The machine's price, from the machine's slot list.
    orderAmount: String(slot.priceMinor),
    notifyUrl: `${params.baseUrl}/api/v1/jetinno/sim/callback`,
    payType: JetinnoPayType.QR,
    ...(config.merchantNo ? { merchantNo: config.merchantNo } : {}),
  };

  // §3.1.2 excludes payType by name, and merchantNo is optional (§2.4 rule 6).
  const body = envelope(config, data, ["payType", "merchantNo"]);
  const response = await post(`${params.baseUrl}/api/v1/jetinno/getQrCode`, body);

  if (response.returnCode !== "SUCCESS" || typeof response.data?.qrCode !== "string") {
    throw new Error(`${response.returnCode}: ${response.msg}`);
  }

  const qrCode = response.data.qrCode;

  return {
    orderNo,
    slot,
    priceMinor: slot.priceMinor,
    qrCode,
    // The machine draws the string it was given. Our server sent text only.
    qrSvg: await QRCode.toString(qrCode, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 260,
    }),
  };
}

/** The §3.5 report, after the machine has finished pouring. */
export async function reportProductDone(params: {
  baseUrl: string;
  deviceNo: string;
  productId: string;
  orderNo: string;
  orderAmountMinor: number;
  isFinish: "SUCCESS" | "ERROR";
}): Promise<{ returnCode: string; msg: string }> {
  const config = jetinnoConfig();

  const data = {
    deviceNo: params.deviceNo,
    productId: params.productId,
    orderNo: params.orderNo,
    orderAmount: String(params.orderAmountMinor),
    isFinish: params.isFinish,
    ...(config.merchantNo ? { merchantNo: config.merchantNo } : {}),
    ...(readInbox(params.orderNo)?.platBillNo
      ? { platBillNo: readInbox(params.orderNo)!.platBillNo }
      : {}),
  };

  const response = await post(
    `${params.baseUrl}/api/v1/jetinno/productdone`,
    // §3.5.2: merchantNo and platBillNo are optional, so unsigned (§2.4 rule 6).
    envelope(config, data, ["merchantNo", "platBillNo"]),
  );

  markReported(params.orderNo);
  return { returnCode: response.returnCode, msg: response.msg };
}
