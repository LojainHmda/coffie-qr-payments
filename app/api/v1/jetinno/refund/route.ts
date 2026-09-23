import { type NextRequest } from "next/server";

import { JetinnoError, findJetinnoOrder } from "@/lib/jetinno/orders";
import { JetinnoCode } from "@/lib/jetinno/protocol";
import { jetinnoErrorResponse, logJetinno, verifyInbound } from "@/lib/jetinno/transport";
import { RefundDataSchema, toMinor } from "@/lib/jetinno/validation";
import { OrderStatus } from "@/lib/orders/order";
import { toMinorUnits } from "@/lib/orders/money";
import { PARSE_FAILED, readJsonBody } from "@/lib/payments/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/jetinno/refund — Jetinno IOT interface §3.4.
 *
 * Authenticated, validated and logged; it does not yet move money. Refunds are
 * listed as out of scope in the README, and the AFS side of one (a reversal
 * against the stored transaction id) is a payment operation in its own right —
 * shipping a handler that answers SUCCESS without having refunded anything
 * would be the single most dangerous thing in this codebase.
 *
 * So the request is checked as far as it can be — signature, order, amount —
 * and refused with a code that tells the operator the truth. Everything a real
 * refund needs is already validated by the time we refuse, which is what makes
 * this a short step to finish rather than a rewrite.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    if (body === PARSE_FAILED) {
      throw new JetinnoError(JetinnoCode.PARAM_ERROR, "Request body must be JSON");
    }

    const { data } = verifyInbound(body, RefundDataSchema);
    const order = findJetinnoOrder(data.orderNo);

    if (order.status !== OrderStatus.PAID) {
      throw new JetinnoError(JetinnoCode.TRADE_ERROR, "Only a paid order can be refunded");
    }

    const requested = toMinor(data.refundAmount);
    if (requested > toMinorUnits(order.total)) {
      throw new JetinnoError(
        JetinnoCode.PARAM_ERROR,
        "refundAmount exceeds the amount paid for this order",
      );
    }

    logJetinno("jetinno.refund.requested", {
      orderId: order.id,
      jetinnoOrderNo: data.orderNo,
      deviceNo: data.deviceNo,
      refundAmount: requested,
      orderTotal: order.total,
    });

    throw new JetinnoError(
      JetinnoCode.TRADE_ERROR,
      "Refunds are not enabled on this integration yet. The request was recorded.",
    );
  } catch (error) {
    return jetinnoErrorResponse("jetinno.refund.failed", error);
  }
}
