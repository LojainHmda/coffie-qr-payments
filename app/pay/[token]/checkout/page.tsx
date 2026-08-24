import Link from "next/link";
import { notFound } from "next/navigation";

import { PayCheckout } from "@/components/pay/PayCheckout";
import { PayShell } from "@/components/pay/PayShell";
import { getMachineByPublicToken } from "@/lib/catalog/machines";
import { getActiveProduct } from "@/lib/catalog/products";
import { merchantEnabledMethods } from "@/lib/payments/methods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pay",
};

/**
 * Product confirmation and payment-method choice.
 *
 * Both the machine and the product are resolved server-side. The price shown
 * is read from the catalogue here and read again from the order when the
 * checkout is created, so what is displayed and what is charged come from the
 * same source and never from the browser.
 */
export default async function CheckoutPage({
  params,
  searchParams,
}: PageProps<"/pay/[token]/checkout">) {
  const { token } = await params;
  const query = await searchParams;

  const machine = getMachineByPublicToken(token);
  if (!machine) notFound();

  const rawProductId = query.productId;
  const productId = Array.isArray(rawProductId) ? rawProductId[0] : rawProductId;
  const product = productId ? getActiveProduct(productId) : undefined;

  if (!product) {
    return (
      <PayShell machineCode={machine.code} machineName={machine.location}>
        <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900">
          <h1 className="text-lg font-semibold tracking-tight">Drink unavailable</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            That drink is not available at this machine.
          </p>
          <Link
            href={`/pay/${machine.publicToken}`}
            className="mt-5 flex min-h-14 w-full items-center justify-center rounded-xl bg-black text-base font-medium text-white dark:bg-white dark:text-black"
          >
            Back to drinks
          </Link>
        </div>
      </PayShell>
    );
  }

  return (
    <PayShell machineCode={machine.code} machineName={machine.location}>
      <PayCheckout
        machineToken={machine.publicToken}
        productId={product.id}
        productName={product.name}
        price={product.price}
        currency={product.currency}
        enabledMethods={merchantEnabledMethods()}
      />
      <div className="mt-4 text-center">
        <Link
          href={`/pay/${machine.publicToken}`}
          className="inline-block py-2 text-xs text-black/50 underline underline-offset-4 dark:text-white/50"
        >
          Choose a different drink
        </Link>
      </div>
    </PayShell>
  );
}
