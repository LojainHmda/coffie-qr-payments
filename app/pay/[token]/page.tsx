import Link from "next/link";
import { notFound } from "next/navigation";

import { PayPanel, PayShell } from "@/components/pay/PayShell";
import { getMachineByPublicToken } from "@/lib/catalog/machines";
import { listActiveProducts } from "@/lib/catalog/products";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Choose a drink",
};

/**
 * The QR landing page.
 *
 * The token in the URL is the machine's opaque public token. It is resolved
 * here server-side; an unknown or inactive token is a 404, so a customer
 * cannot invent a machine by editing the address bar.
 */
export default async function MachinePage({ params }: PageProps<"/pay/[token]">) {
  const { token } = await params;
  const machine = getMachineByPublicToken(token);
  if (!machine) notFound();

  const products = listActiveProducts();

  return (
    <PayShell machineCode={machine.code} machineName={machine.location}>
      <PayPanel>
        <h1 className="text-lg font-semibold tracking-tight">Choose a drink</h1>
        <p className="mt-1 text-sm text-black/60 dark:text-white/60">
          Tap a drink to continue. Prices are set by the machine.
        </p>

        <ul className="mt-4 space-y-2">
          {products.map((product) => (
            <li key={product.id}>
              <Link
                href={`/pay/${machine.publicToken}/checkout?productId=${product.id}`}
                className="flex min-h-16 items-center justify-between gap-4 rounded-xl border border-black/10 px-4 py-3 text-left transition-colors active:bg-black/5 dark:border-white/15 dark:active:bg-white/10"
              >
                <span className="text-base font-medium">{product.name}</span>
                <span className="shrink-0 text-base font-semibold tabular-nums">
                  {product.currency} {product.price}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </PayPanel>
    </PayShell>
  );
}
