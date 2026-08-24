import { NextResponse, type NextRequest } from "next/server";

import { getAppBaseUrl } from "@/lib/payments/afs/config";
import { prepareTestCheckout } from "@/lib/payments/afs/service";
import { PARSE_FAILED, badRequest, clientIpv4, paymentErrorResponse, readJsonBody } from "@/lib/payments/http";
import { CreateTestCheckoutRequestSchema, formatZodIssues } from "@/lib/validation/payment";

/** AFS calls must run on Node, not the edge runtime. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/payments/afs/checkout
 *
 * The standalone /payment-test harness: creates an AFS Copy&Pay checkout for
 * the fixed POC amount, with no machine token and no order. The QR flow uses
 * POST /api/v1/payments/checkout instead.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (body === PARSE_FAILED) {
    return badRequest("Request body must be JSON.");
  }

  const parsed = CreateTestCheckoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid checkout request.", formatZodIssues(parsed.error));
  }

  try {
    const appBaseUrl = getAppBaseUrl(request);
    const checkout = await prepareTestCheckout({
      shopperResultUrl: `${appBaseUrl}/payment-test/result`,
      machineId: parsed.data.machineId,
      customerIp: clientIpv4(request),
    });

    return NextResponse.json(
      {
        checkoutId: checkout.checkoutId,
        amount: checkout.amount,
        currency: checkout.currency,
        widgetScriptUrl: checkout.widgetScriptUrl,
        integrity: checkout.integrity,
        shopperResultUrl: checkout.shopperResultUrl,
        brands: checkout.brands,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return paymentErrorResponse("afs.checkout.failed", error);
  }
}
