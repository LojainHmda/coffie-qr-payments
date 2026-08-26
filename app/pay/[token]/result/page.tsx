import { notFound } from "next/navigation";

import { PayShell } from "@/components/pay/PayShell";
import { OrderError, resolveScannedOrder, verifyOrderPayment, type OrderPaymentResult } from "@/lib/orders/checkout";
import { logPaymentError } from "@/lib/payments/log";
import { PAYMENT_METHOD_LABEL, PaymentStatus } from "@/lib/payments/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Payment result",
};

/**
 * shopperResultUrl target.
 *
 * AFS redirects the browser here with `?resourcePath=/v1/checkouts/{id}/payment`.
 * Landing on this page proves nothing: the status below comes from a
 * server-to-server call to AFS made during this render, and only that call is
 * allowed to mark the order PAID — which is in turn the only thing that tells
 * the machine to pour.
 *
 * Refreshing is safe. The verification short-circuits on an already-settled
 * payment, and an order cannot leave PAID, so a reload produces the same
 * single order and the same single payment record.
 */
export default async function PayResultPage({
  params,
  searchParams,
}: PageProps<"/pay/[token]/result">) {
  const { token } = await params;
  const query = await searchParams;

  let scanned;
  try {
    scanned = resolveScannedOrder(token);
  } catch (error) {
    if (error instanceof OrderError && error.httpStatus === 404) notFound();
    throw error;
  }

  const { order: scannedOrder, machine } = scanned;

  const raw = query.resourcePath;
  const resourcePath = Array.isArray(raw) ? raw[0] : raw;

  if (!resourcePath) {
    return (
      <Outcome
        machineCode={machine.code}
        machineLocation={machine.location}
        token={token}
        variant="failed"
        message="We did not receive a payment reference, so nothing could be confirmed."
      />
    );
  }

  let outcome: OrderPaymentResult | null = null;
  try {
    outcome = await verifyOrderPayment({ payToken: token, resourcePath });
  } catch (error) {
    logPaymentError("pay.result.verification_failed", {
      orderId: scannedOrder.id,
      machineId: machine.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!outcome) {
    return (
      <Outcome
        machineCode={machine.code}
        machineLocation={machine.location}
        token={token}
        variant="failed"
        message="Your payment was not completed."
      />
    );
  }

  const { order, payment } = outcome;

  if (payment.status === PaymentStatus.PENDING) {
    // AFS has the attempt but has not settled it (000.200.xxx). Saying
    // "failed" here would be a lie, and so would "you have not been charged".
    return (
      <Outcome
        machineCode={machine.code}
        machineLocation={machine.location}
        token={token}
        variant="pending"
        message="Your bank has not confirmed this payment yet. Give it a moment, then reload this page."
      />
    );
  }

  if (payment.status !== PaymentStatus.SUCCESS) {
    return (
      <Outcome
        machineCode={machine.code}
        machineLocation={machine.location}
        token={token}
        variant="failed"
        message="Your payment was not completed."
      />
    );
  }

  return (
    <PayShell machineCode={machine.code} machineName={machine.location}>
      <div className="rounded-2xl border border-emerald-500/30 bg-white p-6 text-center shadow-sm dark:bg-neutral-900">
        <div
          aria-hidden
          className="mx-auto flex size-14 items-center justify-center rounded-full bg-emerald-100 text-2xl dark:bg-emerald-500/15"
        >
          ✓
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">Payment Successful</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">Order #{order.orderNumber}</p>

        <div className="mt-5 border-t border-black/5 pt-4 text-left dark:border-white/10">
          {order.items.map((item) => (
            <Row
              key={item.productId}
              label={item.quantity > 1 ? `${item.productName} × ${item.quantity}` : item.productName}
              value={item.totalPrice}
            />
          ))}
          <div className="mt-1 border-t border-black/5 pt-2 dark:border-white/10">
            <Row label="Total" value={`${order.currency} ${order.total}`} strong />
          </div>
          <Row label="Paid with" value={PAYMENT_METHOD_LABEL[payment.method]} />
          <Row label="Machine" value={machine.code} />
        </div>

        <p className="mt-5 text-sm font-medium">Collect your drink at the machine.</p>
      </div>
    </PayShell>
  );
}

const VARIANTS = {
  failed: {
    border: "border-red-500/30",
    badge: "bg-red-100 dark:bg-red-500/15",
    mark: "✕",
    title: "Payment Failed",
    // Only said where it is true: a failed attempt takes no money.
    reassurance: "You have not been charged. Try another payment method.",
    action: "Try again",
  },
  pending: {
    border: "border-amber-500/30",
    badge: "bg-amber-100 dark:bg-amber-500/15",
    mark: "⏳",
    title: "Payment Pending",
    reassurance: null,
    action: "Reload",
  },
} as const;

/**
 * Customers get a plain sentence and a way forward. AFS result codes and
 * gateway diagnostics stay in the server log, where they are useful.
 *
 * "Try again" returns to this order's own payment page, not to a menu: the
 * order is already rung up on the machine and must not be built twice.
 */
function Outcome({
  machineCode,
  machineLocation,
  token,
  variant,
  message,
}: {
  machineCode: string;
  machineLocation: string;
  token: string;
  variant: keyof typeof VARIANTS;
  message: string;
}) {
  const style = VARIANTS[variant];
  return (
    <PayShell machineCode={machineCode} machineName={machineLocation}>
      <div
        className={`rounded-2xl border ${style.border} bg-white p-6 text-center shadow-sm dark:bg-neutral-900`}
      >
        <div
          aria-hidden
          className={`mx-auto flex size-14 items-center justify-center rounded-full text-2xl ${style.badge}`}
        >
          {style.mark}
        </div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">{style.title}</h1>
        <p className="mt-2 text-sm text-black/60 dark:text-white/60">{message}</p>
        {style.reassurance ? (
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">{style.reassurance}</p>
        ) : null}

        {/* Plain anchor, not <Link>: a client-side navigation would keep the
            previous AFS widget globals alive on the next attempt. */}
        <a
          href={`/pay/${token}`}
          className="mt-5 flex min-h-14 w-full items-center justify-center rounded-xl bg-black text-base font-medium text-white dark:bg-white dark:text-black"
        >
          {style.action}
        </a>
      </div>
    </PayShell>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-black/60 dark:text-white/60">{label}</span>
      <span className={strong ? "font-semibold tabular-nums" : "font-medium"}>{value}</span>
    </div>
  );
}
