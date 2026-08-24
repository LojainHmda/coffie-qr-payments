"use client";

import { useState } from "react";

/** Copy-to-clipboard with a short confirmation, for the QR demo page. */
export function CopyButton({ value, label = "Copy URL" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access is blocked over plain http on some browsers. The URL
      // is printed next to this button, so there is always a manual fallback.
      setCopied(false);
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded-lg border border-black/15 px-3 py-1.5 text-xs font-medium transition-colors active:bg-black/5 dark:border-white/20 dark:active:bg-white/10"
    >
      {copied ? "Copied" : label}
    </button>
  );
}
