import { NextResponse, type NextRequest } from "next/server";

import { getAfsConfig } from "@/lib/payments/afs/config";
import { AfsError } from "@/lib/payments/afs/errors";
import {
  decryptWebhookPayload,
  notificationIdFrom,
  readWebhookEnvelope,
} from "@/lib/payments/afs/webhook";
import { logPayment, logPaymentError } from "@/lib/payments/log";
import { markNotificationProcessed } from "@/lib/payments/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/payments/afs/webhook
 *
 * Receives AFS notifications. AFS requires a 2xx within 30 seconds or it
 * retries, so this endpoint acknowledges receipt and never fails the delivery
 * because of a local processing problem.
 *
 * Current state: AFS has not yet supplied the webhook decryption key, so
 * notifications are acknowledged and logged (sanitised, metadata only) but are
 * NOT treated as authenticated. Payment state is still owned by the
 * server-side status verification in /api/v1/payments/afs/status.
 *
 * TODO(AFS): after AFS configures this URL and provides the key, set
 * AFS_WEBHOOK_DECRYPTION_KEY, verify against a real notification, then let
 * verified notifications update the payment record.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const envelope = readWebhookEnvelope(request.headers, rawBody);

  // Metadata only: no body, no headers, no card data, no credentials.
  logPayment("afs.webhook.received", {
    contentType: envelope.contentType,
    hasInitializationVector: Boolean(envelope.ivHex),
    hasAuthenticationTag: Boolean(envelope.authTagHex),
    encryptedBodyBytes: envelope.encryptedBodyHex ? envelope.encryptedBodyHex.length / 2 : 0,
  });

  let decryptionKey: string | null = null;
  try {
    decryptionKey = getAfsConfig().webhookDecryptionKey;
  } catch (error) {
    logPaymentError("afs.webhook.config_unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }

  if (!decryptionKey) {
    logPayment("afs.webhook.unverified", {
      reason: "AFS_WEBHOOK_DECRYPTION_KEY not configured; notification acknowledged only",
    });
    return NextResponse.json({ received: true, verified: false }, { status: 200 });
  }

  try {
    const payload = decryptWebhookPayload(envelope, decryptionKey);
    const notificationId = notificationIdFrom(payload);

    if (!notificationId) {
      logPaymentError("afs.webhook.no_notification_id", {});
      return NextResponse.json({ received: true, verified: true, processed: false }, { status: 200 });
    }

    if (!markNotificationProcessed(notificationId)) {
      logPayment("afs.webhook.duplicate", { notificationId });
      return NextResponse.json({ received: true, verified: true, duplicate: true }, { status: 200 });
    }

    // Sanitised: the logger redacts card-shaped values and sensitive keys.
    logPayment("afs.webhook.verified", { notificationId, payload });

    // TODO(AFS): update the payment record from the verified notification once
    // the payload shape has been confirmed against real AFS traffic.
    return NextResponse.json({ received: true, verified: true, processed: true }, { status: 200 });
  } catch (error) {
    logPaymentError("afs.webhook.verification_failed", {
      kind: error instanceof AfsError ? error.kind : "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
    });
    // Still a 2xx: a decryption problem on our side must not make AFS retry
    // forever. The failure is visible in the logs.
    return NextResponse.json({ received: true, verified: false }, { status: 200 });
  }
}

/** Lets AFS (and us) confirm the URL is reachable before it is configured. */
export async function GET() {
  return NextResponse.json({
    endpoint: "afs-webhook",
    method: "POST",
    ready: true,
    decryptionConfigured: (() => {
      try {
        return getAfsConfig().webhookDecryptionKey !== null;
      } catch {
        return false;
      }
    })(),
  });
}
