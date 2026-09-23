import { NextResponse, type NextRequest } from "next/server";

import { jetinnoConfig } from "@/lib/jetinno/config";
import { JetinnoCode, type JetinnoPayStatus } from "@/lib/jetinno/protocol";
import { verifySignature } from "@/lib/jetinno/signature";
import { recordCallback } from "@/lib/jetinno/simulator";
import { logPayment, logPaymentError } from "@/lib/payments/log";
import { PARSE_FAILED, readJsonBody } from "@/lib/payments/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/jetinno/sim/callback — the simulated MACHINE's notifyUrl (§3.3).
 *
 * This endpoint does not belong to our payment server. It stands in for an
 * address inside a Jetinno machine, and it is the one our own simulator hands
 * over in its §3.1 request. When a payment settles, our server posts here
 * exactly as it would post to real hardware.
 *
 * It verifies our signature before believing a word of it, because that is
 * what a machine does — and because a callback sink that trusted anything
 * posted to it would demonstrate the wrong thing.
 *
 * Simulator only. Real hardware never routes through here.
 */
export async function POST(request: NextRequest) {
  const fail = (code: string, message: string) => {
    logPaymentError("jetinno.sim.callback.rejected", { code, message });
    return NextResponse.json({ returnCode: JetinnoCode.FAIL, msg: code }, { status: 200 });
  };

  try {
    const body = await readJsonBody(request);
    if (body === PARSE_FAILED) return fail(JetinnoCode.PARAM_ERROR, "Body must be JSON");

    const message = body as {
      username?: string;
      time?: string;
      sign?: string;
      data?: Record<string, unknown>;
    };
    if (!message?.data || !message.time || !message.username) {
      return fail(JetinnoCode.PARAM_ERROR, "Malformed envelope");
    }

    const config = jetinnoConfig();
    if (message.username !== config.username) {
      return fail(JetinnoCode.USER_NOT_EXIST, "Unknown username");
    }

    // §3.3.2 includes payType in the signature, so nothing is excluded here.
    const fields = { username: message.username, time: message.time, ...message.data };
    if (!verifySignature(message.sign, fields, config.apikey)) {
      return fail(JetinnoCode.SIGN_ERROR, "Signature does not verify");
    }

    const orderNo = String(message.data.orderNo ?? "");
    if (!orderNo) return fail(JetinnoCode.PARAM_ERROR, "orderNo is missing");

    recordCallback({
      orderNo,
      payStatus: String(message.data.payStatus) as JetinnoPayStatus,
      platBillNo: message.data.platBillNo ? String(message.data.platBillNo) : null,
      receivedAt: new Date().toISOString(),
    });

    logPayment("jetinno.sim.callback.received", {
      orderNo,
      payStatus: message.data.payStatus,
      deviceNo: message.data.deviceNo,
      orderAmount: message.data.orderAmount,
    });

    // The acknowledgement our own notify.ts waits for before it stops retrying.
    return NextResponse.json(
      { returnCode: JetinnoCode.SUCCESS, msg: JetinnoCode.SUCCESS },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return fail(
      JetinnoCode.SYSTEM_ERROR,
      error instanceof Error ? error.message : "Unexpected error",
    );
  }
}
