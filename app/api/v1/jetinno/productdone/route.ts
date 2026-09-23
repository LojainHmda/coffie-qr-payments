import { type NextRequest } from "next/server";

import { JetinnoError, recordFulfilment } from "@/lib/jetinno/orders";
import { JetinnoCode } from "@/lib/jetinno/protocol";
import { jetinnoErrorResponse, jetinnoResponse, logJetinno, verifyInbound } from "@/lib/jetinno/transport";
import { ProductDoneDataSchema } from "@/lib/jetinno/validation";
import { PARSE_FAILED, readJsonBody } from "@/lib/payments/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/jetinno/productdone — Jetinno IOT interface §3.5.
 *
 * The machine reporting whether it actually made the drink. This is the only
 * place the physical world reaches this system, and it is the answer to the
 * question the rest of the app cannot ask: the money moved, but did coffee
 * come out?
 *
 * `isFinish: ERROR` on a PAID order is the case worth watching. The payment
 * stays valid — the customer really was charged — and the order carries a
 * failed fulfilment, which is what a refund gets decided from.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (body === PARSE_FAILED) {
      throw new JetinnoError(JetinnoCode.PARAM_ERROR, "Request body must be JSON");
    }

    const { config, data } = verifyInbound(body, ProductDoneDataSchema);
    const order = recordFulfilment(data);

    logJetinno("jetinno.productdone.accepted", {
      orderId: order.id,
      jetinnoOrderNo: data.orderNo,
      deviceNo: data.deviceNo,
      isFinish: data.isFinish,
      fulfilment: order.fulfilment,
    });

    return jetinnoResponse(JetinnoCode.SUCCESS, {
      config,
      data: { deviceNo: data.deviceNo, orderNo: data.orderNo },
    });
  } catch (error) {
    return jetinnoErrorResponse("jetinno.productdone.failed", error);
  }
}
