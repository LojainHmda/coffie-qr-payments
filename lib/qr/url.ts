import { headers } from "next/headers";

/**
 * Base URL that a QR code should encode.
 *
 * A QR is scanned by a phone, not by this machine, so `localhost` is useless
 * in one. The order of preference is:
 *
 *   1. QR_BASE_URL   — set this to override everything (e.g. an https tunnel).
 *   2. APP_BASE_URL  — the app's configured public URL, shared with AFS.
 *   3. the Host header of the request that rendered the page.
 *
 * (3) is what makes the demo work with no configuration: open the admin page
 * from your phone's point of view — http://192.168.1.45:3000/admin/machines —
 * and every QR on it already carries that same LAN address.
 */
export async function resolveQrBaseUrl(): Promise<string> {
  const configured = process.env.QR_BASE_URL?.trim() || process.env.APP_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  if (!host) return "";
  return `${proto}://${host}`;
}

export function machinePayUrl(baseUrl: string, publicToken: string): string {
  return `${baseUrl}/pay/${publicToken}`;
}

/** True when the QR points at localhost, which a phone cannot reach. */
export function isUnreachableFromPhone(baseUrl: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$|\/)/i.test(baseUrl);
}
