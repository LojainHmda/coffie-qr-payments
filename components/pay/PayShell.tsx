import type { ReactNode } from "react";

/**
 * Mobile-first frame for the customer-facing QR pages.
 *
 * Sized for a phone held in one hand: a single column, generous tap targets,
 * and the machine identity always visible so the customer can confirm they
 * are paying the machine in front of them. It still centres sensibly on a
 * desktop, which is where the demo gets shown.
 */
export function PayShell({
  machineCode,
  machineName,
  children,
}: {
  machineCode: string;
  machineName?: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh justify-center bg-neutral-50 px-4 py-6 dark:bg-neutral-950">
      <div className="w-full max-w-md">
        <header className="mb-4 flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-lg text-white dark:bg-white dark:text-neutral-900"
          >
            ☕
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight">{machineCode}</p>
            {machineName ? (
              <p className="truncate text-xs text-black/50 dark:text-white/50">{machineName}</p>
            ) : null}
          </div>
        </header>
        {children}
        <p className="mt-6 text-center text-[11px] text-black/40 dark:text-white/40">
          AFS TEST environment — no real money moves.
        </p>
      </div>
    </main>
  );
}

/** Full-width primary action, sized for a thumb. */
export function PayPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-black/10 bg-white p-5 shadow-sm dark:border-white/15 dark:bg-neutral-900 ${className}`}
    >
      {children}
    </section>
  );
}
