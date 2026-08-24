import { createDecipheriv } from "node:crypto";

import { AfsError } from "./errors";

/**
 * AFS webhook decryption.
 *
 * Documented format (https://afs.docs.oppwa.com/tutorials/webhooks):
 *   - POST over HTTPS
 *   - `X-Initialization-Vector` header: IV, hex
 *   - `X-Authentication-Tag` header: GCM auth tag, hex
 *   - body: hex ciphertext, either raw (text/plain) or {"encryptedBody": "..."}
 *   - AES-256-GCM, no padding, 64-hex-character secret key
 *
 * STATUS: the code below follows that documentation and is covered by a
 * round-trip unit test, but it has NEVER been run against a real AFS
 * notification because AFS has not yet supplied AFS_WEBHOOK_DECRYPTION_KEY.
 * Until a real notification has been decrypted successfully, a webhook must
 * NOT be treated as an authenticated statement about a payment — confirm
 * every payment with the status API instead.
 *
 * TODO(AFS): once AFS provides the key, set AFS_WEBHOOK_DECRYPTION_KEY, replay
 * a real notification, and only then let webhook payloads drive payment state.
 */

export const WEBHOOK_IV_HEADER = "x-initialization-vector";
export const WEBHOOK_AUTH_TAG_HEADER = "x-authentication-tag";

export interface WebhookEnvelope {
  ivHex: string | null;
  authTagHex: string | null;
  encryptedBodyHex: string | null;
  contentType: string | null;
}

/** Pull the documented envelope out of the request without decrypting. */
export function readWebhookEnvelope(headers: Headers, rawBody: string): WebhookEnvelope {
  const contentType = headers.get("content-type");
  let encryptedBodyHex: string | null = rawBody.trim() || null;

  if (contentType?.includes("application/json")) {
    try {
      const parsed = JSON.parse(rawBody) as { encryptedBody?: unknown };
      encryptedBodyHex = typeof parsed.encryptedBody === "string" ? parsed.encryptedBody : null;
    } catch {
      encryptedBodyHex = null;
    }
  }

  return {
    ivHex: headers.get(WEBHOOK_IV_HEADER),
    authTagHex: headers.get(WEBHOOK_AUTH_TAG_HEADER),
    encryptedBodyHex,
    contentType,
  };
}

const HEX = /^[0-9a-fA-F]+$/;

/**
 * Decrypt an AFS notification. Throws AfsError("VERIFICATION") when the key is
 * missing, the envelope is incomplete, or the GCM auth tag does not validate.
 */
export function decryptWebhookPayload(envelope: WebhookEnvelope, keyHex: string | null): unknown {
  if (!keyHex) {
    throw new AfsError("VERIFICATION", "AFS_WEBHOOK_DECRYPTION_KEY is not configured", {
      publicMessage: "Webhook verification is not configured.",
      httpStatus: 503,
    });
  }
  if (!HEX.test(keyHex) || keyHex.length !== 64) {
    throw new AfsError("VERIFICATION", "AFS_WEBHOOK_DECRYPTION_KEY must be 64 hex characters", {
      publicMessage: "Webhook verification is not configured.",
      httpStatus: 503,
    });
  }

  const { ivHex, authTagHex, encryptedBodyHex } = envelope;
  if (!ivHex || !authTagHex || !encryptedBodyHex) {
    throw new AfsError("VERIFICATION", "Incomplete AFS webhook envelope", {
      publicMessage: "Malformed webhook.",
      httpStatus: 400,
      details: {
        hasIv: Boolean(ivHex),
        hasAuthTag: Boolean(authTagHex),
        hasBody: Boolean(encryptedBodyHex),
      },
    });
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(keyHex, "hex"),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encryptedBodyHex, "hex")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext);
  } catch (cause) {
    throw new AfsError("VERIFICATION", "AFS webhook could not be decrypted or authenticated", {
      publicMessage: "Webhook could not be verified.",
      httpStatus: 400,
      cause,
    });
  }
}

/**
 * Stable id used for idempotency. AFS notifications carry the payment id in
 * `payload.id`; fall back to the checkout/merchant reference when present.
 */
export function notificationIdFrom(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const nested = (record.payload ?? {}) as Record<string, unknown>;
  const candidate = record.id ?? nested.id ?? nested.merchantTransactionId;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}
