import { networkInterfaces } from "node:os";

import type { NextConfig } from "next";

/**
 * Every IPv4 address this machine answers on, so the dev server accepts the
 * phone that scanned a QR.
 *
 * Next.js blocks cross-origin requests to dev-only assets: opening the app at
 * http://192.168.1.45:3000 when the server was started as `localhost` makes
 * `/_next/static/chunks/*.js` return 403. The page still renders — it is
 * server-rendered — but the client bundle never loads, so nothing hydrates and
 * every button is dead HTML. It looks like broken JavaScript rather than a
 * blocked request, which is why it is worth detecting rather than documenting.
 *
 * Detecting the interfaces means the QR demo works on whatever Wi-Fi you are
 * on, with no config edit. DEV_ORIGINS adds anything else (a tunnel hostname,
 * a .local name).
 */
function localNetworkOrigins(): string[] {
  const origins = new Set<string>(["localhost", "127.0.0.1"]);

  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        origins.add(address.address);
      }
    }
  }

  for (const extra of (process.env.DEV_ORIGINS ?? "").split(",")) {
    const trimmed = extra.trim();
    if (trimmed) origins.add(trimmed);
  }

  return [...origins];
}

const nextConfig: NextConfig = {
  // Development only — Next ignores this in a production build.
  allowedDevOrigins: localNetworkOrigins(),

  /**
   * Emit a self-contained server bundle at .next/standalone so the container
   * image carries only the files actually needed to run, instead of the whole
   * node_modules tree. Required by the Dockerfile used for Cloud Run.
   */
  output: "standalone",
};

export default nextConfig;
