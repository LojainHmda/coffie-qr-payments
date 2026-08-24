import Link from "next/link";

import { Card, CardSubtitle, CardTitle } from "@/components/ui/Card";

const LINKS = [
  {
    href: "/admin/machines",
    title: "Machine QR codes",
    description: "Scan one of these with a phone to start a purchase.",
    primary: true,
  },
  {
    href: "/admin/orders",
    title: "Orders dashboard",
    description: "What was bought, from which machine, and whether AFS confirmed it.",
    primary: false,
  },
  {
    href: "/payment-test",
    title: "AFS payment harness",
    description: "The original fixed-amount round-trip test, kept for regressions.",
    primary: false,
  },
];

export default function Home() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-neutral-50 p-4 dark:bg-neutral-950">
      <Card>
        <CardTitle>Coffee Machine Payments</CardTitle>
        <CardSubtitle>
          QR payment platform on the AFS gateway. TEST environment only — no real payments, and the
          machines themselves are not connected to this system.
        </CardSubtitle>

        <div className="mt-6 space-y-3">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={
                link.primary
                  ? "block rounded-xl bg-neutral-900 px-4 py-3 text-white dark:bg-white dark:text-neutral-900"
                  : "block rounded-xl border border-black/10 px-4 py-3 dark:border-white/15"
              }
            >
              <span className="block text-sm font-medium">{link.title}</span>
              <span
                className={
                  link.primary
                    ? "mt-0.5 block text-xs text-white/70 dark:text-neutral-900/70"
                    : "mt-0.5 block text-xs text-black/50 dark:text-white/50"
                }
              >
                {link.description}
              </span>
            </Link>
          ))}
        </div>
      </Card>
    </main>
  );
}
