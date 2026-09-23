import { z } from "zod";

/**
 * Jetinno integration configuration.
 *
 * `username` and `apikey` are issued by Guangzhou Jetinno per merchant (§2.1).
 * The apikey is the shared secret behind every signature in both directions,
 * so it is server-only and must never be prefixed NEXT_PUBLIC_.
 *
 * The integration is absent-by-default: with no apikey configured the routes
 * still exist but refuse every request, rather than accepting unsigned traffic.
 */

export class JetinnoConfigError extends Error {
  readonly problems: string[];

  constructor(message: string, problems: string[] = []) {
    super(message);
    this.name = "JetinnoConfigError";
    this.problems = problems;
  }
}

const EnvSchema = z.object({
  JETINNO_USERNAME: z
    .string()
    .trim()
    .min(1, "JETINNO_USERNAME is missing. Jetinno issue it alongside the apikey.")
    .max(32),
  /**
   * §2.4 describes the apikey as 16 bytes. The length is reported rather than
   * enforced: a merchant whose key is a different length should not be blocked
   * by our reading of one sentence.
   */
  JETINNO_APIKEY: z
    .string()
    .trim()
    .min(8, "JETINNO_APIKEY is missing. Jetinno issue it alongside the username."),
  JETINNO_MERCHANT_NO: z.string().trim().max(32).optional(),
  /**
   * Upper bound on a single order, in minor units.
   *
   * The machine states the amount in this protocol, so this is the backstop
   * against a mis-set price list, a decimal-point bug in firmware, or a
   * malformed message turning into a large charge. A signed message is proof
   * of origin, not proof that the number in it is sane.
   */
  JETINNO_MAX_ORDER_MINOR: z.coerce.number().int().positive().default(100_000),
  /**
   * `deviceNo:MACHINE-CODE` pairs mapping Jetinno's device numbers onto the
   * machines in our own registry, e.g. `44401:MACHINE-001,44402:MACHINE-002`.
   *
   * Optional. An unmapped device still trades — its orders are attributed to
   * `jetinno:<deviceNo>` and the dashboard shows that raw id — because refusing
   * to sell coffee over a missing row in a lookup table is the wrong failure.
   */
  JETINNO_DEVICE_MAP: z.string().trim().optional(),
});

/** Parse JETINNO_DEVICE_MAP. Malformed pairs are skipped, not fatal. */
function parseDeviceMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw?.trim()) return map;

  for (const entry of raw.split(",")) {
    const separator = entry.indexOf(":");
    if (separator < 1) continue;
    const deviceNo = entry.slice(0, separator).trim();
    const machineCode = entry.slice(separator + 1).trim();
    if (deviceNo && machineCode) map.set(deviceNo, machineCode.toUpperCase());
  }
  return map;
}

export interface JetinnoConfig {
  username: string;
  apikey: string;
  merchantNo: string | null;
  maxOrderMinor: number;
  /** Jetinno device number -> our machine code. Possibly empty. */
  deviceMap: Map<string, string>;
  /** True when the apikey is not the 16 bytes §2.4 describes. Surfaced, not fatal. */
  unusualApikeyLength: boolean;
}

export type JetinnoEnv = Record<string, string | undefined>;

/**
 * Parse and validate the Jetinno environment. Exported so it can be unit-tested
 * without touching process.env.
 */
export function parseJetinnoConfig(env: JetinnoEnv): JetinnoConfig {
  const parsed = EnvSchema.safeParse({
    JETINNO_USERNAME: env.JETINNO_USERNAME,
    JETINNO_APIKEY: env.JETINNO_APIKEY,
    JETINNO_MERCHANT_NO: env.JETINNO_MERCHANT_NO?.trim() ? env.JETINNO_MERCHANT_NO : undefined,
    JETINNO_MAX_ORDER_MINOR: env.JETINNO_MAX_ORDER_MINOR?.trim()
      ? env.JETINNO_MAX_ORDER_MINOR
      : undefined,
    JETINNO_DEVICE_MAP: env.JETINNO_DEVICE_MAP,
  });

  if (!parsed.success) {
    // Field names and our own messages only — never the values themselves.
    throw new JetinnoConfigError(
      "Jetinno integration is not configured.",
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`),
    );
  }

  return {
    username: parsed.data.JETINNO_USERNAME,
    apikey: parsed.data.JETINNO_APIKEY,
    merchantNo: parsed.data.JETINNO_MERCHANT_NO ?? null,
    maxOrderMinor: parsed.data.JETINNO_MAX_ORDER_MINOR,
    deviceMap: parseDeviceMap(parsed.data.JETINNO_DEVICE_MAP),
    unusualApikeyLength: parsed.data.JETINNO_APIKEY.length !== 16,
  };
}

export function jetinnoConfig(env: JetinnoEnv = process.env): JetinnoConfig {
  if (typeof window !== "undefined") {
    throw new JetinnoConfigError(
      "Jetinno config was imported in the browser. The apikey is server-only.",
    );
  }
  return parseJetinnoConfig(env);
}

/** Whether the integration is configured at all, without throwing. */
export function isJetinnoConfigured(env: JetinnoEnv = process.env): boolean {
  try {
    parseJetinnoConfig(env);
    return true;
  } catch {
    return false;
  }
}
