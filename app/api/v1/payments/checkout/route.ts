import { NextResponse, type NextRequest } from "next/server";

import { orderErrorStatus, startOrderPayment } from "@/lib/orders/checkout";
import { getAppBaseUrl } from "@/lib/payments/afs/config";
import { PARSE_FAILED, badRequest, clientIpv4, readJsonBody } from "@/lib/payments/http";
import { logPaymentError } from "@/lib/payments/log";
import { CreateCheckoutRequestSchema, formatZodIssues } from "@/lib/validation/payment";

/** AFS calls must run on Node, not the edge runtime. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/payments/checkout
 *
 * Body: { payToken, method }
 *
 * The pay token comes from the QR the machine printed and resolves to one
 * already-priced order. Creates the provider checkout for it and returns only
 * what the browser needs to render the payment widget. The amount is read from
 * the order; the access token stays on the server.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (body === PARSE_FAILED) {
    return badRequest("Request body must be JSON.");
  }

  const parsed = CreateCheckoutRequestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid checkout request.", formatZodIssues(parsed.error));
  }

  const { payToken, method } = parsed.data;

  try {
    const appBaseUrl = getAppBaseUrl(request);
    const { order, checkout } = await startOrderPayment({
      payToken,
      method,
      // AFS redirects here after the payment; the page verifies server-side.
      shopperResultUrl: `${appBaseUrl}/pay/${payToken}/result`,
      customerIp: clientIpv4(request),
    });

    return NextResponse.json(
      {
        checkoutId: checkout.checkoutId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: checkout.amount,
        currency: checkout.currency,
        method,
        widgetScriptUrl: checkout.widgetScriptUrl,
        integrity: checkout.integrity,
        shopperResultUrl: checkout.shopperResultUrl,
        brands: checkout.brands,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, message } = orderErrorStatus(error);
    // The pay token is a bearer credential for one order, so it is never
    // logged — only the fact that a checkout for some token failed.
    logPaymentError("order.checkout.failed", {
      status,
      method,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: message }, { status });
  }
}
