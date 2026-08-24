import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`w-full max-w-md rounded-2xl border border-black/10 bg-white p-6 shadow-sm dark:border-white/15 dark:bg-neutral-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h1 className="text-xl font-semibold tracking-tight">{children}</h1>;
}

export function CardSubtitle({ children }: { children: ReactNode }) {
  return <p className="mt-1 text-sm text-black/60 dark:text-white/60">{children}</p>;
}

export function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-black/5 py-2 text-sm last:border-b-0 dark:border-white/10">
      <span className="text-black/60 dark:text-white/60">{label}</span>
      <span className="text-right font-medium break-all">{value}</span>
    </div>
  );
}
