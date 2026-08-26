"use server";

import { getMachineByCode } from "@/lib/catalog/machines";
import { renderOrderQr } from "@/lib/machines/orderQr";
import {
  OrderError,
  createMachineOrder,
  machineOrderView,
  type MachineOrderView,
} from "@/lib/orders/checkout";
import { logPaymentError } from "@/lib/payments/log";
import {
  CreateMachineOrderRequestSchema,
  MachineOrderIdSchema,
  formatZodIssues,
} from "@/lib/validation/payment";

/**
 * The machine terminal's own path to the server.
 *
 * Why server actions rather than the machine's HTTP API: a real machine holds
 * its API key in its own firmware, but this simulator runs in a browser. Using
 * the HTTP API from the page would mean shipping a machine credential to every
 * visitor. These actions run on the server and resolve the machine from the
 * code in the URL, so no key exists client-side to leak.
 *
 * That does mean anyone who can open /machine/{code} can ring up an order on
 * that machine — which is exactly what standing in front of the machine lets
 * you do. Both /machine/* and /admin/* need real authentication before this is
 * exposed to anyone but the demo (see the README's production checklist).
 *
 * A server action is a public endpoint, so every argument here is validated as
 * if it came from a stranger, because it can.
 */

export interface TerminalOrder {
  orderId: string;
  orderNumber: number;
  total: string;
  currency: string;
  items: Array<{ productId: string; productName: string; quantity: number; totalPrice: string }>;
  payUrl: string;
  qrSvg: string;
  qrUnreachable: boolean;
  expiresAt: string;
}

export type TerminalResult<T> = { ok: true; data: T } | { ok: false; error: string };

function machineOr404(code: string) {
  const machine = getMachineByCode(code);
  if (!machine) {
    throw new OrderError("Unknown machine code", 404, "This machine could not be found.");
  }
  return machine;
}

function failure(event: string, error: unknown): { ok: false; error: string } {
  const message = error instanceof OrderError ? error.publicMessage : "Something went wrong.";
  logPaymentError(event, {
    message: error instanceof Error ? error.message : String(error),
  });
  return { ok: false, error: message };
}

/** Ring up the basket the customer just built on the machine screen. */
export async function createTerminalOrder(
  code: string,
  lines: unknown,
): Promise<TerminalResult<TerminalOrder>> {
  try {
    const machine = machineOr404(code);

    const parsed = CreateMachineOrderRequestSchema.safeParse({ lines });
    if (!parsed.success) {
      return { ok: false, error: formatZodIssues(parsed.error).join("; ") };
    }

    const order = createMachineOrder({ machine, lines: parsed.data.lines });
    const qr = await renderOrderQr(order);

    return {
      ok: true,
      data: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        total: order.total,
        currency: order.currency,
        items: order.items.map((item) => ({
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          totalPrice: item.totalPrice,
        })),
        payUrl: qr.payUrl,
        qrSvg: qr.svg,
        qrUnreachable: qr.unreachable,
        // The pay token itself is deliberately NOT returned. It lives inside
        // the QR image; putting it in the page as text would let anyone
        // shoulder-surfing the machine pay for, and collect, this drink.
        expiresAt: order.payTokenExpiresAt,
      },
    };
  } catch (error) {
    return failure("machine.terminal.create_failed", error);
  }
}

/**
 * Poll one order. `dispense` turns true only after a payment was verified
 * server-to-server with AFS — never because a phone reached a success screen.
 */
export async function readTerminalOrder(
  code: string,
  orderId: unknown,
): Promise<TerminalResult<MachineOrderView>> {
  try {
    const machine = machineOr404(code);

    const parsed = MachineOrderIdSchema.safeParse(orderId);
    if (!parsed.success) {
      return { ok: false, error: "Invalid order id." };
    }

    return { ok: true, data: machineOrderView(machine, parsed.data) };
  } catch (error) {
    return failure("machine.terminal.read_failed", error);
  }
}
