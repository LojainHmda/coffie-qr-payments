import { NextResponse, type NextRequest } from "next/server";

import { createMachineOrder, orderErrorStatus } from "@/lib/orders/checkout";
import { PARSE_FAILED, badRequest, readJsonBody } from "@/lib/payments/http";
import { logPaymentError } from "@/lib/payments/log";
import { CreateOrderRequestSchema, formatZodIssues } from "@/lib/validation/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/orders
 *
 * Body: { machineToken, productId }
 *
 * The response deliberately echoes the total back: it is what the SERVER
 * decided, read from the product catalogue. The browser never sends a price
 * and the value here is for display only — the checkout re-reads the order.
 */
export async function POST(request: NextRequest) {
  const body = await readJsonBody(request);
  if (body === PARSE_FAILED) {
    return badRequest("Request body must be JSON.");
  }

  const parsed = CreateOrderRequestSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("Invalid order request.", formatZodIssues(parsed.error));
  }

  try {
    const order = createMachineOrder(parsed.data);
    return NextResponse.json(
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        currency: order.currency,
        status: order.status,
        items: order.items,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const { status, message } = orderErrorStatus(error);
    logPaymentError("order.create.failed", {
      status,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: message }, { status });
  }
}
