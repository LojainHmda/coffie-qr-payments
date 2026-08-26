import QRCode from "qrcode";

import type { Order } from "@/lib/orders/order";
import { isUnreachableFromPhone, orderPayUrl, resolveQrBaseUrl } from "@/lib/qr/url";

/**
 * Turn an order into the thing the machine actually shows: a QR of its pay URL.
 *
 * The QR is rendered to SVG here, on the server, so no QR library reaches the
 * browser bundle and no third-party image service ever sees a pay token.
 */

export interface OrderQr {
  payUrl: string;
  /** Inline SVG markup, generated from our own URL string. */
  svg: string;
  /** True when the URL points somewhere a scanning phone cannot reach. */
  unreachable: boolean;
}

export async function renderOrderQr(order: Order): Promise<OrderQr> {
  const baseUrl = await resolveQrBaseUrl();
  const payUrl = orderPayUrl(baseUrl, order.payToken);

  const svg = await QRCode.toString(payUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 260,
  });

  return { payUrl, svg, unreachable: isUnreachableFromPhone(baseUrl) };
}
