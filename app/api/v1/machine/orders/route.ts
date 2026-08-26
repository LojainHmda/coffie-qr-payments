import { NextResponse, type NextRequest } from "next/server";

import { MachineAuthError, authenticateMachine } from "@/lib/machines/auth";
import { renderOrderQr } from "@/lib/machines/orderQr";
import { createMachineOrder, orderErrorStatus } from "@/lib/orders/checkout";
import { PARSE_FAILED, badRequest, readJsonBody } from "@/lib/payments/http";
import { logPaymentError } from "@/lib/payments/log";
import { CreateMachineOrderRequestSchema, formatZodIssues } from "@/lib/validation/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/machine/orders
 *
 * Called by the coffee machine after the customer has finished choosing on its
 * own screen.
 *
 *   Authorization: Bearer <machine api key>
 *   Body: { lines: [{ productId, quantity }] }
 *
 * Returns the order plus the QR to print on the machine display. The response
 * echoes the total because that is what the SERVER decided from the catalogue —
 * the machine sends no prices and the value here is for the machine's own
 * display only.
 *
 * The pay token is returned so the machine can render its own QR if it would
 * rather not use ours; it must not be shown as text on the machine screen,
 * since anyone reading it could pay for — and collect — someone else's drink.
 */
export async function POST(request: NextRequest) {
  let machineCode = "unknown";

  try {
    const machine = authenticateMachine(request.headers);
    machineCode = machine.code;

    const body = await readJsonBody(request);
    if (body === PARSE_FAILED) {
      return badRequest("Request body must be JSON.");
    }

    const parsed = CreateMachineOrderRequestSchema.safeParse(body);
    if (!parsed.success) {
      return badRequest("Invalid order request.", formatZodIssues(parsed.error));
    }

    const order = createMachineOrder({ machine, lines: parsed.data.lines });
    const qr = await renderOrderQr(order);

    return NextResponse.json(
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        machineCode: machine.code,
        status: order.status,
        items: order.items,
        total: order.total,
        currency: order.currency,
        payToken: order.payToken,
        payUrl: qr.payUrl,
        qrSvg: qr.svg,
        qrUnreachable: qr.unreachable,
        expiresAt: order.payTokenExpiresAt,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof MachineAuthError) {
      logPaymentError("machine.auth.rejected", { message: error.message });
      return NextResponse.json({ error: error.publicMessage }, { status: error.httpStatus });
    }

    const { status, message } = orderErrorStatus(error);
    logPaymentError("machine.order.create_failed", {
      status,
      machineCode,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: message }, { status });
  }
}
