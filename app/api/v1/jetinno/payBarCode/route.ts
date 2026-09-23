import { type NextRequest } from "next/server";

import { JetinnoError } from "@/lib/jetinno/orders";
import { JetinnoCode } from "@/lib/jetinno/protocol";
import { jetinnoErrorResponse, logJetinno, verifyInbound } from "@/lib/jetinno/transport";
import { PayBarCodeDataSchema } from "@/lib/jetinno/validation";
import { PARSE_FAILED, readJsonBody } from "@/lib/payments/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/jetinno/payBarCode — Jetinno IOT interface §3.2.
 *
 * Reverse scan: the machine's own scanner reads a barcode off the customer's
 * phone and asks us to charge it. It is the mirror image of §3.1, and this
 * gateway cannot do it.
 *
 * AFS Copy&Pay takes a card on a hosted form in the customer's browser. There
 * is no endpoint in that product that accepts a payment barcode as an
 * instrument, so there is nothing for this handler to charge.
 *
 * The request is still authenticated and logged, and then refused with a
 * reason. The alternative — creating an order and answering PAYING, which
 * §3.2.3 defines as "the result will arrive on the callback" — would strand
 * the machine waiting for a callback that can never be sent, and strand the
 * customer in front of it.
 *
 * To enable this interface, AFS must provision a barcode/scan-based payment
 * product and the charge call goes here.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (body === PARSE_FAILED) {
      throw new JetinnoError(JetinnoCode.PARAM_ERROR, "Request body must be JSON");
    }

    const { data } = verifyInbound(body, PayBarCodeDataSchema);

    logJetinno("jetinno.payBarCode.unsupported", {
      jetinnoOrderNo: data.orderNo,
      deviceNo: data.deviceNo,
      orderAmount: data.orderAmount,
    });

    throw new JetinnoError(
      JetinnoCode.TRADE_ERROR,
      "Reverse scan is not supported by this gateway. Use the forward-scan flow (getQrCode).",
    );
  } catch (error) {
    return jetinnoErrorResponse("jetinno.payBarCode.failed", error);
  }
}
