import { Card, CardSubtitle, CardTitle, DetailRow } from "@/components/ui/Card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TEST_PAYMENT_AMOUNT, TEST_PAYMENT_CURRENCY } from "@/lib/payments/afs/constants";
import { AfsError } from "@/lib/payments/afs/errors";
import { verifyPaymentByResourcePath, type VerifiedPayment } from "@/lib/payments/afs/service";
import { logPaymentError } from "@/lib/payments/log";
import { PaymentStatus } from "@/lib/payments/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "AFS Payment Result",
};

/**
 * shopperResultUrl target.
 *
 * AFS redirects the browser here with `?resourcePath=/v1/checkouts/{id}/payment`.
 * Landing on this page proves nothing: the status below comes from a
 * server-to-server call to AFS made during this render.
 */
export default async function PaymentResultPage({
  searchParams,
}: PageProps<"/payment-test/result">) {
  const params = await searchParams;
  const raw = params.resourcePath;
  const resourcePath = Array.isArray(raw) ? raw[0] : raw;

  if (!resourcePath) {
    return (
      <Shell>
        <CardTitle>Payment Result Unknown</CardTitle>
        <CardSubtitle>
          AFS did not send a resourcePath, so the payment could not be verified with the gateway.
        </CardSubtitle>
        <TryAgain />
      </Shell>
    );
  }

  let result: VerifiedPayment | null = null;
  let failureMessage: string | null = null;

  try {
    result = await verifyPaymentByResourcePath(resourcePath);
  } catch (error) {
    logPaymentError("afs.result_page.verification_failed", {
      kind: error instanceof AfsError ? error.kind : "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
    });
    failureMessage =
      error instanceof AfsError
        ? error.publicMessage
        : "The payment could not be verified with AFS.";
  }

  if (!result) {
    return (
      <Shell>
        <CardTitle>Verification Failed</CardTitle>
        <CardSubtitle>{failureMessage}</CardSubtitle>
        <div className="mt-5">
          <DetailRow label="Amount" value={`${TEST_PAYMENT_CURRENCY} ${TEST_PAYMENT_AMOUNT}`} />
          <DetailRow label="Status" value={<StatusBadge status={PaymentStatus.FAILED} />} />
        </div>
        <TryAgain />
      </Shell>
    );
  }

  const succeeded = result.status === PaymentStatus.SUCCESS;
  const { title, subtitle } = HEADLINES[result.status];

  return (
    <Shell>
      <CardTitle>{title}</CardTitle>
      <CardSubtitle>{subtitle}</CardSubtitle>

      <div className="mt-5">
        <DetailRow label="Status" value={<StatusBadge status={result.status} />} />
        <DetailRow label="Amount" value={`${result.currency} ${result.amount}`} />
        <DetailRow label="Currency" value={result.currency} />
        <DetailRow label="Transaction" value={result.transactionId ?? "—"} />
        <DetailRow label="Result code" value={result.resultCode ?? "—"} />
        <DetailRow label="Message" value={result.resultMessage ?? "—"} />
        {result.paymentBrand ? <DetailRow label="Brand" value={result.paymentBrand} /> : null}
      </div>

      {result.needsManualReview ? (
        <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-300">
          AFS accepted this payment but flagged it for manual review.
        </p>
      ) : null}

      {result.mismatches.length > 0 ? (
        <p className="mt-4 rounded-xl bg-red-50 p-3 text-xs text-red-800 dark:bg-red-500/10 dark:text-red-300">
          Amount/currency mismatch reported by AFS: {result.mismatches.join("; ")}
        </p>
      ) : null}

      {succeeded ? null : <TryAgain />}
      {succeeded ? (
        <div className="mt-6">
          <a
            href="/payment-test"
            className="block w-full rounded-xl border border-black/10 px-4 py-3 text-center text-sm font-medium dark:border-white/15"
          >
            Run another test
          </a>
        </div>
      ) : null}
    </Shell>
  );
}

const HEADLINES: Record<PaymentStatus, { title: string; subtitle: string }> = {
  SUCCESS: {
    title: "Payment Successful",
    subtitle: "Verified server-side with AFS.",
  },
  FAILED: {
    title: "Payment Failed",
    subtitle: "AFS did not confirm this payment. Verified server-side.",
  },
  PENDING: {
    title: "Payment Pending",
    subtitle: "AFS has not settled this payment yet. Verified server-side.",
  },
  CREATED: {
    title: "Payment Not Started",
    subtitle: "No payment attempt has reached AFS for this checkout.",
  },
  CANCELLED: {
    title: "Payment Cancelled",
    subtitle: "The payment was cancelled before it completed.",
  },
  EXPIRED: {
    title: "Payment Expired",
    subtitle: "This checkout is no longer valid. Start a new payment.",
  },
  REFUNDED: {
    title: "Payment Refunded",
    subtitle: "This payment was refunded.",
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <Card>{children}</Card>
    </main>
  );
}

function TryAgain() {
  return (
    <div className="mt-6">
      {/* Plain anchor, not <Link>: a client-side navigation back to the test
          page would keep the previous AFS widget globals alive. */}
      <a
        href="/payment-test"
        className="block w-full rounded-xl bg-neutral-900 px-4 py-3 text-center text-sm font-medium text-white dark:bg-white dark:text-neutral-900"
      >
        Try Again
      </a>
    </div>
  );
}
