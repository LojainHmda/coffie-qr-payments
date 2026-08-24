import type { PaymentStatus } from "@/lib/payments/payment";

const STYLES: Record<PaymentStatus, string> = {
  SUCCESS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  FAILED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  PENDING: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  CREATED: "bg-neutral-200 text-neutral-800 dark:bg-white/10 dark:text-white/70",
  CANCELLED: "bg-neutral-200 text-neutral-800 dark:bg-white/10 dark:text-white/70",
  EXPIRED: "bg-neutral-200 text-neutral-800 dark:bg-white/10 dark:text-white/70",
  REFUNDED: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
};

/**
 * `label` lets an order status borrow the matching payment colour without
 * pretending to be that payment status — e.g. an order shows "PAID" in the
 * SUCCESS palette.
 */
export function StatusBadge({ status, label }: { status: PaymentStatus; label?: string }) {
  return (
    <span
      className={`inline-block rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${STYLES[status]}`}
    >
      {label ?? status}
    </span>
  );
}
