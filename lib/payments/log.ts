/**
 * Sanitised logging for the payment layer.
 *
 * Nothing here may ever emit: access tokens, PANs, CVV/CVC, expiry dates or
 * raw gateway payloads. Keys are matched by name and values are scrubbed for
 * card-number-shaped digit runs.
 */

const REDACTED = "[redacted]";

const SENSITIVE_KEY = new RegExp(
  [
    "token",
    "secret",
    "password",
    "authorization",
    "auth",
    "key",
    "number",
    "pan",
    "cvv",
    "cvc",
    "securitycode",
    "expiry",
    "expmonth",
    "expyear",
    "holder",
    "iban",
  ].join("|"),
  "i",
);

/** 12-19 consecutive digits, optionally separated by spaces or dashes. */
const CARD_LIKE = /\b(?:\d[ -]?){12,19}\b/g;

function scrubString(value: string): string {
  return value.replace(CARD_LIKE, REDACTED);
}

export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitize(item, depth + 1));
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      output[key] = SENSITIVE_KEY.test(key) ? REDACTED : sanitize(entry, depth + 1);
    }
    return output;
  }
  return "[unloggable]";
}

export function logPayment(event: string, data: Record<string, unknown> = {}) {
  console.log(
    JSON.stringify({
      at: new Date().toISOString(),
      scope: "payments",
      event,
      ...(sanitize(data) as Record<string, unknown>),
    }),
  );
}

export function logPaymentError(event: string, data: Record<string, unknown> = {}) {
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      scope: "payments",
      level: "error",
      event,
      ...(sanitize(data) as Record<string, unknown>),
    }),
  );
}
