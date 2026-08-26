import { NextResponse, type NextRequest } from "next/server";

import { MachineAuthError, authenticateMachine } from "@/lib/machines/auth";
import { machineOrderView, orderErrorStatus } from "@/lib/orders/checkout";
import { badRequest } from "@/lib/payments/http";
import { logPaymentError } from "@/lib/payments/log";
import { MachineOrderIdSchema } from "@/lib/validation/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/machine/orders/{orderId}
 *
 *   Authorization: Bearer <machine api key>
 *
 * How the machine learns it may pour. It polls this until `dispense` is true,
 * which happens only once a payment has been verified server-to-server with
 * AFS — the customer's phone reaching a success screen is not what sets it.
 *
 * A machine can only read its own orders, even with a valid key.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;

  try {
    const machine = authenticateMachine(request.headers);

    const parsed = MachineOrderIdSchema.safeParse(orderId);
    if (!parsed.success) {
      return badRequest("Invalid order id.");
    }

    const view = machineOrderView(machine, parsed.data);

    return NextResponse.json(view, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof MachineAuthError) {
      logPaymentError("machine.auth.rejected", { message: error.message });
      return NextResponse.json({ error: error.publicMessage }, { status: error.httpStatus });
    }

    const { status, message } = orderErrorStatus(error);
    // A 404/403 here is ordinary polling noise, not an incident: only log the
    // cases that are not.
    if (status >= 500) {
      logPaymentError("machine.order.read_failed", {
        status,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return NextResponse.json({ error: message }, { status });
  }
}
