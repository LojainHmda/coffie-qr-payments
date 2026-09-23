import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Jetinno IOT Payment Universal Interface — message signing (§2.4).
 *
 * Every message in both directions carries `sign`: an uppercase MD5 over the
 * request's own fields plus the shared `apikey`. The apikey is never
 * transmitted; it is only ever the tail of the string being hashed, which is
 * what makes the signature a proof of possession.
 *
 * The rule, as the specification states it:
 *
 *   1. Flatten the envelope's `username` and `time` together with every field
 *      inside `data`. The name "data" itself does not appear.
 *   2. Drop parameters whose value is null.
 *   3. Sort the remaining parameter names by ASCII, ascending.
 *   4. Join them as `key1=value1&key2=value2`.
 *   5. Prepend `nonce` when one is present; append the apikey.
 *   6. MD5, hex, uppercased.
 *
 * Verified against the worked example in §2.5 — see tests/jetinno-signature.
 *
 * ---------------------------------------------------------------------------
 * On the specification's one ambiguity
 *
 * §2.4 rule 6 (added in V1.3) says optional ("required field: N") parameters
 * do not participate. The §2.5 example is consistent with that — it omits
 * `merchantNo` — but predates V1.2 and so also omits `productId` and
 * `productName`, which are required. There is no worked example of a message
 * carrying an optional field, so whether a given sender actually applies rule
 * 6 is unverified. Only `payType` is called out by name: excluded in §3.1.2,
 * included in §3.3.2 (where it is required).
 *
 * `verifySignature` therefore accepts the signature if it matches ANY of a
 * small set of candidate readings. That costs nothing in security — each
 * candidate is still an MD5 keyed on the apikey, so a caller who does not hold
 * the apikey cannot produce any of them — and it means a real machine is not
 * rejected over a disagreement about one optional field.
 *
 * Signing follows rule 6 strictly: callers pass the interface's optional
 * fields as `exclude`.
 * ---------------------------------------------------------------------------
 */

export type SignatureFields = Record<string, unknown>;

/** Envelope members that are structure, not signed content. */
const NEVER_SIGNED = new Set(["sign", "nonce", "data"]);

/**
 * Fields the specification is ambiguous about — every optional (N) field in
 * the §3 tables, plus payType. Verification tries the message both with and
 * without each of these (16 candidates); signing decides explicitly per
 * interface via the `exclude` option.
 */
export const AMBIGUOUS_FIELDS = ["payType", "attach", "merchantNo", "platBillNo"] as const;

/** §3.3.2 optional fields: sent in the callback, never signed (rule 6). */
export const CALLBACK_UNSIGNED_FIELDS = ["platBillNo", "attach"] as const;

/**
 * Render a value the way it appears on the wire.
 *
 * Numbers are stringified rather than rejected because `orderAmount` is
 * documented as a string but arrives as a JSON number from some firmware
 * builds, and `1000` and `"1000"` have to hash identically.
 */
function wireValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length === 0 ? null : value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : null;
  if (typeof value === "boolean") return String(value);
  return null;
}

/**
 * The exact string that gets hashed. Exported because a signature mismatch is
 * otherwise undebuggable: the only useful question is "which string did each
 * side build?", and that question needs an answer that is not the apikey.
 */
export function signatureBase(
  fields: SignatureFields,
  options: { exclude?: readonly string[]; nonce?: string | null } = {},
): string {
  const excluded = new Set(options.exclude ?? []);

  const pairs: string[] = [];
  for (const [key, raw] of Object.entries(fields)) {
    if (NEVER_SIGNED.has(key) || excluded.has(key)) continue;
    const value = wireValue(raw);
    if (value === null) continue;
    pairs.push(`${key}=${value}`);
  }

  // Default sort is UTF-16 code-unit order, which is ASCII order for the
  // ASCII-only parameter names this protocol uses.
  pairs.sort();

  const nonce = options.nonce?.trim();
  return `${nonce ?? ""}${pairs.join("&")}`;
}

/** Uppercase MD5 of the signature base with the apikey appended. */
export function signFields(
  fields: SignatureFields,
  apikey: string,
  options: { exclude?: readonly string[]; nonce?: string | null } = {},
): string {
  const base = signatureBase(fields, options);
  return createHash("md5").update(`${base}${apikey}`, "utf8").digest("hex").toUpperCase();
}

/** Constant-time comparison of two hex digests of the same length. */
function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Every subset of the ambiguous fields, as exclusion lists to try. */
function candidateExclusions(base: readonly string[]): string[][] {
  const subsets: string[][] = [[]];
  for (const field of AMBIGUOUS_FIELDS) {
    for (const existing of [...subsets]) {
      subsets.push([...existing, field]);
    }
  }
  return subsets.map((subset) => [...base, ...subset]);
}

/**
 * Check a signature presented by a caller.
 *
 * `presented` is compared case-insensitively: the specification requires
 * uppercase, but rejecting an otherwise-correct lowercase digest would fail a
 * machine over letter case rather than over authenticity.
 */
export function verifySignature(
  presented: string | null | undefined,
  fields: SignatureFields,
  apikey: string,
  options: { exclude?: readonly string[]; nonce?: string | null } = {},
): boolean {
  const candidate = presented?.trim().toUpperCase();
  if (!candidate || candidate.length !== 32) return false;

  for (const exclude of candidateExclusions(options.exclude ?? [])) {
    if (digestsMatch(candidate, signFields(fields, apikey, { ...options, exclude }))) {
      return true;
    }
  }
  return false;
}

/** `yyyyMMddHHmmss` in UTC, the timestamp format every message carries (§2.2). */
export function jetinnoTimestamp(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return [
    now.getUTCFullYear(),
    pad(now.getUTCMonth() + 1),
    pad(now.getUTCDate()),
    pad(now.getUTCHours()),
    pad(now.getUTCMinutes()),
    pad(now.getUTCSeconds()),
  ].join("");
}
