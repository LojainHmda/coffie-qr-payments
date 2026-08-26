import Link from "next/link";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { getMachineById, listMachines } from "@/lib/catalog/machines";
import { OrderStatus } from "@/lib/orders/order";
import { listOrders } from "@/lib/orders/store";
import { PAYMENT_METHOD_LABEL, PaymentStatus } from "@/lib/payments/payment";
import { getPaymentsByOrderId } from "@/lib/payments/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Orders",
};

/**
 * Owner dashboard.
 *
 * Answers one question at a glance: who bought what, from which machine, and
 * did AFS actually confirm the money. Every value here is server state — the
 * AFS transaction id shown is the `id` AFS returned from the payment lookup,
 * never anything this application invented.
 *
 * Filtering is done with plain links and searchParams so it survives a reload
 * and needs no client JavaScript.
 */
export default async function OrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const query = await searchParams;
  const machineFilter = single(query.machine);
  const statusFilter = single(query.status);

  const orders = listOrders().filter((order) => {
    if (machineFilter && order.machineId !== machineFilter) return false;
    if (statusFilter && order.status !== statusFilter) return false;
    return true;
  });

  const machines = listMachines();
  const paidCount = orders.filter((order) => order.status === OrderStatus.PAID).length;
  const paidTotal = orders
    .filter((order) => order.status === OrderStatus.PAID)
    .reduce((sum, order) => sum + Number.parseFloat(order.total), 0);

  return (
    <main className="min-h-dvh bg-neutral-50 px-4 py-8 dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            {orders.length} order{orders.length === 1 ? "" : "s"} · {paidCount} paid ·{" "}
            {paidTotal.toFixed(2)} AED collected
          </p>
          <nav className="mt-3 text-sm">
            <Link href="/admin/machines" className="underline underline-offset-4">
              Machines
            </Link>
          </nav>
        </header>

        <div className="mb-4 flex flex-wrap gap-2">
          <FilterLink href="/admin/orders" label="All machines" active={!machineFilter} />
          {machines.map((machine) => (
            <FilterLink
              key={machine.id}
              href={buildHref({ machine: machine.id, status: statusFilter })}
              label={machine.code}
              active={machineFilter === machine.id}
            />
          ))}
          <span className="w-full" />
          <FilterLink
            href={buildHref({ machine: machineFilter })}
            label="Any status"
            active={!statusFilter}
          />
          {Object.values(OrderStatus).map((status) => (
            <FilterLink
              key={status}
              href={buildHref({ machine: machineFilter, status })}
              label={status}
              active={statusFilter === status}
            />
          ))}
        </div>

        {orders.length === 0 ? (
          <p className="rounded-2xl border border-black/10 bg-white p-8 text-center text-sm text-black/50 dark:border-white/15 dark:bg-neutral-900 dark:text-white/50">
            No orders yet. Open a machine screen, choose a drink, and scan the code it prints.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white shadow-sm dark:border-white/15 dark:bg-neutral-900">
            <table className="w-full min-w-[54rem] text-left text-sm">
              <thead className="border-b border-black/10 text-xs tracking-wide text-black/50 uppercase dark:border-white/10 dark:text-white/50">
                <tr>
                  <Th>Order</Th>
                  <Th>Machine</Th>
                  <Th>Items</Th>
                  <Th>Amount</Th>
                  <Th>Method</Th>
                  <Th>Provider</Th>
                  <Th>Status</Th>
                  <Th>AFS transaction</Th>
                  <Th>Created</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const machine = getMachineById(order.machineId);
                  const attempts = getPaymentsByOrderId(order.id);
                  // Prefer the settled attempt; otherwise show the latest try.
                  const payment =
                    attempts.find((entry) => entry.status === PaymentStatus.SUCCESS) ??
                    attempts.at(-1);

                  return (
                    <tr
                      key={order.id}
                      className="border-b border-black/5 last:border-b-0 dark:border-white/10"
                    >
                      <Td className="font-medium">#{order.orderNumber}</Td>
                      <Td>{machine?.code ?? order.machineId}</Td>
                      <Td>
                        {order.items.length === 0
                          ? "—"
                          : order.items
                              .map((item) =>
                                item.quantity > 1
                                  ? `${item.productName} × ${item.quantity}`
                                  : item.productName,
                              )
                              .join(", ")}
                      </Td>
                      <Td className="tabular-nums">
                        {order.currency} {order.total}
                      </Td>
                      <Td>{payment ? PAYMENT_METHOD_LABEL[payment.method] : "—"}</Td>
                      <Td>{payment?.provider ?? "—"}</Td>
                      <Td>
                        <OrderStatusBadge status={order.status} />
                      </Td>
                      <Td className="max-w-[16rem] font-mono text-xs break-all">
                        {payment?.transactionId ?? "—"}
                      </Td>
                      <Td className="text-xs whitespace-nowrap text-black/50 dark:text-white/50">
                        {new Date(order.createdAt).toLocaleString()}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-6 text-xs leading-relaxed text-black/40 dark:text-white/40">
          Orders are held in memory for this POC, so restarting the dev server clears this table.
        </p>
      </div>
    </main>
  );
}

/**
 * Order status reuses the payment badge palette where the names line up, and
 * falls back to a neutral chip for the order-only states.
 */
function OrderStatusBadge({ status }: { status: OrderStatus }) {
  if (status === OrderStatus.PAID) return <StatusBadge status={PaymentStatus.SUCCESS} label="PAID" />;
  if (status === OrderStatus.FAILED) return <StatusBadge status={PaymentStatus.FAILED} />;
  if (status === OrderStatus.CANCELLED) return <StatusBadge status={PaymentStatus.CANCELLED} />;
  return <StatusBadge status={PaymentStatus.PENDING} label={status} />;
}

function buildHref(filters: { machine?: string; status?: string }): string {
  const search = new URLSearchParams();
  if (filters.machine) search.set("machine", filters.machine);
  if (filters.status) search.set("status", filters.status);
  const query = search.toString();
  return query ? `/admin/orders?${query}` : "/admin/orders";
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function FilterLink({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-neutral-900"
          : "rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium dark:border-white/20"
      }
    >
      {label}
    </Link>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-medium">{children}</th>;
}

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;
}
