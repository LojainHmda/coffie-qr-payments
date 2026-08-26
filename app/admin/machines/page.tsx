import Link from "next/link";

import { CopyButton } from "@/components/admin/CopyButton";
import { demoKeysInUse, listMachines } from "@/lib/catalog/machines";
import { isUnreachableFromPhone, resolveQrBaseUrl } from "@/lib/qr/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Machines",
};

/**
 * Machine registry.
 *
 * There is deliberately no QR on this page. A QR is per-ORDER now, not per
 * machine: it exists only once a customer has chosen their drinks on the
 * machine, and it dies with that order. What this page offers instead is a way
 * into each machine's screen.
 */
export default async function MachinesPage() {
  const baseUrl = await resolveQrBaseUrl();
  const machines = listMachines();
  const unreachable = isUnreachableFromPhone(baseUrl);
  const demoKeys = demoKeysInUse();

  return (
    <main className="min-h-dvh bg-neutral-50 px-4 py-8 dark:bg-neutral-950">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Machines</h1>
          <p className="mt-1 text-sm text-black/60 dark:text-white/60">
            Open a machine&rsquo;s screen to place an order the way a customer would. The machine
            prints the QR; the phone only pays.
          </p>
          <nav className="mt-3 text-sm">
            <Link href="/admin/orders" className="underline underline-offset-4">
              Orders dashboard
            </Link>
          </nav>
        </header>

        {unreachable ? (
          <p className="mb-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            This page is open at <code className="font-mono">{baseUrl}</code>, which a phone cannot
            reach — so the QR a machine prints would not be scannable either. Open it at your
            computer&rsquo;s LAN address instead, for example{" "}
            <code className="font-mono">http://192.168.1.45:3000/admin/machines</code>, with both
            devices on the same Wi-Fi.
          </p>
        ) : null}

        {demoKeys.length > 0 ? (
          <p className="mb-6 rounded-xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            {demoKeys.join(", ")} {demoKeys.length === 1 ? "is" : "are"} still using the API key
            committed to this repository. Set <code className="font-mono">MACHINE_API_KEYS</code>{" "}
            before any machine talks to a real deployment.
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {machines.map((machine) => {
            const terminalUrl = `${baseUrl}/machine/${machine.code}`;
            return (
              <section
                key={machine.id}
                className="rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900"
              >
                <h2 className="text-base font-semibold tracking-tight">{machine.code}</h2>
                <p className="text-xs text-black/50 dark:text-white/50">{machine.location}</p>

                <Link
                  href={`/machine/${machine.code}`}
                  className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl bg-black text-sm font-medium text-white dark:bg-white dark:text-black"
                >
                  Open machine screen
                </Link>

                <p className="mt-3 font-mono text-[11px] break-all text-black/50 dark:text-white/50">
                  {terminalUrl}
                </p>

                <div className="mt-3 flex items-center gap-2">
                  <CopyButton value={terminalUrl} />
                  <Link
                    href={`/admin/orders?machine=${machine.id}`}
                    className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium transition-colors active:bg-black/5 dark:border-white/20 dark:active:bg-white/10"
                  >
                    Orders
                  </Link>
                </div>
              </section>
            );
          })}
        </div>

        <p className="mt-6 text-xs leading-relaxed text-black/40 dark:text-white/40">
          Machine API keys are never shown here. The machine screen talks to the server through
          server actions, so no machine credential is sent to a browser.
        </p>
      </div>
    </main>
  );
}
