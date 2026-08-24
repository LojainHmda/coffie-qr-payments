import { createCipheriv, randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { AfsError } from "@/lib/payments/afs/errors";
import {
  decryptWebhookPayload,
  notificationIdFrom,
  readWebhookEnvelope,
} from "@/lib/payments/afs/webhook";
import { markNotificationProcessed, resetPaymentStore } from "@/lib/payments/store";

const KEY_HEX = randomBytes(32).toString("hex");

/** Produce a notification in the documented AFS format (AES-256-GCM, hex). */
function encryptNotification(payload: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(KEY_HEX, "hex"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payload), "utf8")),
    cipher.final(),
  ]);
  return {
    ivHex: iv.toString("hex"),
    authTagHex: cipher.getAuthTag().toString("hex"),
    encryptedBodyHex: ciphertext.toString("hex"),
    contentType: "text/plain",
  };
}

describe("readWebhookEnvelope", () => {
  it("reads a raw hex body", () => {
    const headers = new Headers({
      "content-type": "text/plain",
      "X-Initialization-Vector": "aabb",
      "X-Authentication-Tag": "ccdd",
    });
    const envelope = readWebhookEnvelope(headers, "deadbeef");
    expect(envelope).toMatchObject({
      ivHex: "aabb",
      authTagHex: "ccdd",
      encryptedBodyHex: "deadbeef",
    });
  });

  it("unwraps a JSON-wrapped body", () => {
    const headers = new Headers({ "content-type": "application/json" });
    const envelope = readWebhookEnvelope(headers, JSON.stringify({ encryptedBody: "deadbeef" }));
    expect(envelope.encryptedBodyHex).toBe("deadbeef");
  });
});

describe("decryptWebhookPayload", () => {
  it("decrypts a well-formed notification", () => {
    const payload = { type: "PAYMENT", payload: { id: "txn-1", result: { code: "000.100.110" } } };
    const decrypted = decryptWebhookPayload(encryptNotification(payload), KEY_HEX);
    expect(decrypted).toEqual(payload);
  });

  it("refuses to run without a configured key", () => {
    let caught: unknown;
    try {
      decryptWebhookPayload(encryptNotification({}), null);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AfsError);
    expect((caught as AfsError).message).toContain("AFS_WEBHOOK_DECRYPTION_KEY");
  });

  it("rejects a key of the wrong length", () => {
    expect(() => decryptWebhookPayload(encryptNotification({}), "abcd")).toThrowError(
      /64 hex characters/,
    );
  });

  it("rejects a tampered authentication tag", () => {
    const envelope = encryptNotification({ id: "txn-1" });
    const tampered = { ...envelope, authTagHex: randomBytes(16).toString("hex") };
    expect(() => decryptWebhookPayload(tampered, KEY_HEX)).toThrowError(/could not be decrypted/);
  });

  it("rejects an incomplete envelope", () => {
    const envelope = { ...encryptNotification({}), ivHex: null };
    expect(() => decryptWebhookPayload(envelope, KEY_HEX)).toThrowError(/Incomplete/);
  });
});

describe("notificationIdFrom", () => {
  it("reads a top-level id", () => {
    expect(notificationIdFrom({ id: "txn-1" })).toBe("txn-1");
  });

  it("reads a nested payload id", () => {
    expect(notificationIdFrom({ payload: { id: "txn-2" } })).toBe("txn-2");
  });

  it("returns null when no id is present", () => {
    expect(notificationIdFrom({ type: "PAYMENT" })).toBeNull();
    expect(notificationIdFrom("nonsense")).toBeNull();
  });
});

describe("webhook idempotency", () => {
  it("processes a notification id only once", () => {
    resetPaymentStore();
    expect(markNotificationProcessed("txn-1")).toBe(true);
    expect(markNotificationProcessed("txn-1")).toBe(false);
    expect(markNotificationProcessed("txn-2")).toBe(true);
  });
});
