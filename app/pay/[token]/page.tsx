import { notFound } from "next/navigation";

import { PayCheckout } from "@/components/pay/PayCheckout";
import { PayPanel, PayShell } from "@/components/pay/PayShell";
import { OrderError, resolveScannedOrder } from "@/lib/orders/checkout";
import { OrderStatus, isPayWindowOpen } from "@/lib/orders/order";
import { logPaymentError } from "@/lib/payments/log";
import { merchantEnabledMethods } from "@/lib/payments/methods";
import { walletClientConfig, walletConfigProblems } from "@/lib/payments/wallets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pay",
};

/**
 * The QR landing page.
 *
 * The token in the URL is one ORDER's pay token, printed by the machine after
 * the customer finished choosing on it. There is nothing to select here: the
 * page shows what the machine rang up and offers the ways to pay for it.
 *
 * An unknown token is a 404 — the order does not exist, and nothing about a
 * real order is revealed by guessing.
 */
export default async function PayPage({ params }: PageProps<"/pay/[token]">) {
  const { token } = await params;

  let scanned;
  try {
    scanned = resolveScannedOrder(token);
  } catch (error) {
    if (error instanceof OrderError && error.httpStatus === 404) notFound();
    throw error;
  }

  const { order, machine } = scanned;

  if (order.status === OrderStatus.PAID) {
    return (
      <PayShell machineCode={machine.code} machineName={machine.location}>
        <PayPanel className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">Already paid</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Order #{order.orderNumber} has been paid. Collect your drink at the machine.
          </p>
        </PayPanel>
      </PayShell>
    );
  }

  if (!isPayWindowOpen(order)) {
    return (
      <PayShell machineCode={machine.code} machineName={machine.location}>
        <PayPanel className="text-center">
          <h1 className="text-lg font-semibold tracking-tight">This code has expired</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Order #{order.orderNumber} was not paid in time. Choose your drink again on the machine
            to get a fresh code.
          </p>
          <p className="mt-3 text-xs text-black/45 dark:text-white/45">
            You have not been charged.
          </p>
        </PayPanel>
      </PayShell>
    );
  }

  // A wallet named in AFS_WALLET_METHODS but missing the configuration it needs
  // degrades to "no button", never to a broken page — but it must not do so
  // silently, or an operator sees only a mysteriously absent wallet.
  const problems = walletConfigProblems();
  if (problems.length > 0) {
    logPaymentError("wallet.config.incomplete", { problems });
  }

  return (
    <PayShell machineCode={machine.code} machineName={machine.location}>
      <PayCheckout
        payToken={order.payToken}
        order={{
          orderNumber: order.orderNumber,
          items: order.items,
          total: order.total,
          currency: order.currency,
        }}
        enabledMethods={merchantEnabledMethods()}
        wallets={walletClientConfig()}
      />
    </PayShell>
  );
}
