import { JetinnoTerminal } from "@/components/machine/JetinnoTerminal";
import { isJetinnoConfigured } from "@/lib/jetinno/config";
import { SLOTS } from "@/lib/jetinno/simulator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Jetinno machine",
};

/**
 * A Jetinno machine's screen, standing in for the hardware.
 *
 * `/machine/{code}` demonstrates our own machine API, where the server prices
 * the basket. This page demonstrates the other model: the machine prices its
 * own slot, calls §3.1 for a QR string, draws that string itself, and waits to
 * be told the outcome on the callback address it supplied.
 *
 * The device number is free-form so any value can be tried — map one to a real
 * machine with JETINNO_DEVICE_MAP, or use an unmapped one and watch the order
 * land under `jetinno:<deviceNo>` in the dashboard.
 */
export default async function JetinnoMachinePage({
  params,
}: PageProps<"/machine/jetinno/[deviceNo]">) {
  const { deviceNo } = await params;

  return (
    <main className="flex min-h-dvh justify-center bg-neutral-50 px-4 py-6 dark:bg-neutral-950">
      <div className="w-full">
        <JetinnoTerminal
          deviceNo={deviceNo}
          slots={[...SLOTS]}
          configured={isJetinnoConfigured()}
        />
        <p className="mt-6 text-center text-[11px] text-black/40 dark:text-white/40">
          Jetinno IOT protocol simulator · AFS TEST environment — no real money moves.
        </p>
      </div>
    </main>
  );
}
