import { notFound } from "next/navigation";

import { MachineTerminal } from "@/components/machine/MachineTerminal";
import { getMachineByCode } from "@/lib/catalog/machines";
import { listActiveProducts } from "@/lib/catalog/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Machine",
};

/**
 * The coffee machine's own screen.
 *
 * This is where an order is born. The customer chooses here, on the machine, and
 * only then does a QR exist — one per order, carrying that order's pay token.
 * The phone that scans it can do exactly one thing: pay.
 *
 * Standing in for hardware that is not built yet. `/machine/*` is unauthenticated
 * like `/admin/*`, which is fine for a demo and listed in the README as
 * something that must change before production.
 */
export default async function MachinePage({ params }: PageProps<"/machine/[code]">) {
  const { code } = await params;

  const machine = getMachineByCode(code);
  if (!machine) notFound();

  return (
    <main className="flex min-h-dvh justify-center bg-neutral-50 px-4 py-6 dark:bg-neutral-950">
      <div className="w-full">
        <MachineTerminal
          machineCode={machine.code}
          machineLocation={machine.location}
          products={listActiveProducts()}
        />
        <p className="mt-6 text-center text-[11px] text-black/40 dark:text-white/40">
          Machine simulator · AFS TEST environment — no real money moves.
        </p>
      </div>
    </main>
  );
}
