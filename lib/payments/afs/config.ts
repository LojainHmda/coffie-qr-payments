import { z } from "zod";

import { AFS_TEST_BASE_URL } from "./constants";
import { AfsError } from "./errors";
import type { AfsConfig } from "./types";

/**
 * Guard against ever bundling the access token into client code. This module
 * must only be imported from server components / route handlers.
 */
function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new AfsError(
      "CONFIG",
      "AFS config was imported in the browser. The access token is server-only.",
      { httpStatus: 500 },
    );
  }
}

const EnvSchema = z.object({
  AFS_ENTITY_ID: z
    .string()
    .trim()
    .min(1, "AFS_ENTITY_ID is missing. Add it to .env.local."),
  AFS_ACCESS_TOKEN: z
    .string()
    .trim()
    .min(1, "AFS_ACCESS_TOKEN is missing. Add it to .env.local."),
  AFS_BASE_URL: z
    .string()
    .trim()
    .min(1)
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "https:";
      } catch {
        return false;
      }
    }, "AFS_BASE_URL must be an absolute https URL, e.g. https://eu-test.oppwa.com/")
    .default(AFS_TEST_BASE_URL),
  AFS_CURRENCY: z
    .string()
    .trim()
    .regex(/^[A-Z]{3}$/, "AFS_CURRENCY must be a 3-letter ISO 4217 code, e.g. AED")
    .default("AED"),
  AFS_WEBHOOK_DECRYPTION_KEY: z.string().trim().optional(),
});

export type AfsEnv = Record<string, string | undefined>;

/**
 * Parse and validate the AFS environment. Exported (rather than only used
 * internally) so it can be unit-tested without touching process.env.
 */
export function parseAfsConfig(env: AfsEnv): AfsConfig {
  const parsed = EnvSchema.safeParse({
    AFS_ENTITY_ID: env.AFS_ENTITY_ID,
    AFS_ACCESS_TOKEN: env.AFS_ACCESS_TOKEN,
    // Let `.default()` apply when the variable is absent or blank.
    AFS_BASE_URL: env.AFS_BASE_URL?.trim() ? env.AFS_BASE_URL : undefined,
    AFS_CURRENCY: env.AFS_CURRENCY?.trim() ? env.AFS_CURRENCY : undefined,
    AFS_WEBHOOK_DECRYPTION_KEY: env.AFS_WEBHOOK_DECRYPTION_KEY,
  });

  if (!parsed.success) {
    // Only field names and our own messages — never the values themselves.
    const problems = parsed.error.issues.map(
      (issue) => `${issue.path.join(".") || "env"}: ${issue.message}`,
    );
    throw new AfsError("CONFIG", `Invalid AFS configuration -> ${problems.join("; ")}`, {
      publicMessage: "AFS is not configured on this server.",
      httpStatus: 500,
      details: { problems },
    });
  }

  const data = parsed.data;
  const key = data.AFS_WEBHOOK_DECRYPTION_KEY?.trim();

  return {
    entityId: data.AFS_ENTITY_ID,
    accessToken: data.AFS_ACCESS_TOKEN,
    baseUrl: data.AFS_BASE_URL.endsWith("/") ? data.AFS_BASE_URL : `${data.AFS_BASE_URL}/`,
    currency: data.AFS_CURRENCY,
    webhookDecryptionKey: key ? key : null,
  };
}

/** Read the AFS configuration from process.env. Throws AfsError("CONFIG"). */
export function getAfsConfig(): AfsConfig {
  assertServerOnly();
  return parseAfsConfig(process.env);
}

/**
 * Absolute base URL of this application, used to build the shopperResultUrl
 * that AFS redirects the shopper back to.
 *
 * The Host header, not `request.url`, decides. A phone that scanned a QR
 * reached us on http://192.168.1.45:3000, but `request.url` inside a route
 * handler reports the server's own origin — which is localhost. Redirecting
 * the phone to localhost sends it to itself and the payment appears to vanish,
 * so the header the client actually used is the only trustworthy source.
 *
 * APP_BASE_URL overrides everything when it is set, which is what a deployment
 * (or an https tunnel) wants.
 */
export function getAppBaseUrl(request: { url: string; headers: Headers }): string {
  const configured = process.env.APP_BASE_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) {
    const proto = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }

  return new URL(request.url).origin;
}

/** Public (non-secret) view of the config, safe for diagnostics endpoints. */
export function describeAfsConfig(config: AfsConfig) {
  return {
    baseUrl: config.baseUrl,
    currency: config.currency,
    entityIdConfigured: config.entityId.length > 0,
    accessTokenConfigured: config.accessToken.length > 0,
    webhookDecryptionKeyConfigured: config.webhookDecryptionKey !== null,
  };
}
