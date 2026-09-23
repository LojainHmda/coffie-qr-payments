import { type NextRequest } from "next/server";

import { getAfsConfig } from "@/lib/payments/afs/config";
import { PARSE_FAILED, readJsonBody } from "@/lib/payments/http";
import { JetinnoError, createJetinnoOrder, qrCodeForOrder } from "@/lib/jetinno/orders";
import { JetinnoCode } from "@/lib/jetinno/protocol";
import { jetinnoErrorResponse, jetinnoResponse, logJetinno, verifyInbound } from "@/lib/jetinno/transport";
import { GetQrCodeDataSchema } from "@/lib/jetinno/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/jetinno/getQrCode — Jetinno IOT interface §3.1.
 *
 * The customer has finished choosing on the machine and the machine has priced
 * the basket. It now wants one thing from us: a string to draw on its screen.
 *
 * We answer with the URL of this order's payment page. §3.1.3 caps the field
 * at 128 characters and does not constrain its content, so no gateway-issued
 * QR payload is required for the flow to work.
 *
 * Give this URL to Jetinno as the "Get QR Code" address for the merchant.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (body === PARSE_FAILED) {
      throw new JetinnoError(JetinnoCode.PARAM_ERROR, "Request body must be JSON");
    }

    // §3.1.2 states payType does not participate in signature verification.
    const { config, data } = verifyInbound(body, GetQrCodeDataSchema, {
      excludeFromSignature: ["payType"],
    });

    const { order, replayed } = createJetinnoOrder({
      config,
      data,
      currency: getAfsConfig().currency,
    });

    // A retry gets the same order and therefore the same QR — one cup, one
    // order, however many times the 8-second timeout fires.
    const qrCode = await qrCodeForOrder(order);

    logJetinno("jetinno.getQrCode.served", {
      orderId: order.id,
      jetinnoOrderNo: data.orderNo,
      deviceNo: data.deviceNo,
      total: order.total,
      currency: order.currency,
      replayed,
    });

    return jetinnoResponse(JetinnoCode.SUCCESS, {
      config,
      data: {
        deviceNo: data.deviceNo,
        orderNo: data.orderNo,
        qrCode,
      },
    });
  } catch (error) {
    return jetinnoErrorResponse("jetinno.getQrCode.failed", error);
  }
}
