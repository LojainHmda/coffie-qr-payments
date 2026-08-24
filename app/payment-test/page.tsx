import { PaymentTest } from "./components/PaymentTest";
import {
  TEST_MACHINE_ID,
  TEST_PAYMENT_AMOUNT,
  TEST_PAYMENT_CURRENCY,
  TEST_PRODUCT_NAME,
} from "@/lib/payments/afs/constants";

export const metadata = {
  title: "AFS Payment Test",
  description: "AFS TEST environment payment proof of concept",
};

/**
 * The POC entry point. The amount shown here is only a label — the server
 * decides what is actually charged when the checkout is prepared.
 */
export default function PaymentTestPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <PaymentTest
        amount={TEST_PAYMENT_AMOUNT}
        currency={TEST_PAYMENT_CURRENCY}
        product={TEST_PRODUCT_NAME}
        machineId={TEST_MACHINE_ID}
      />
    </main>
  );
}
