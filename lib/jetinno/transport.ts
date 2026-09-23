import { NextResponse } from "next/server";
import type { z } from "zod";

import { logPayment, logPaymentError } from "@/lib/payments/log";

import { jetinnoConfig, JetinnoConfigError, type JetinnoConfig } from "./config";
import { JetinnoError } from "./orders";
import { JetinnoCode, type JetinnoResponseEnvelope } from "./protocol";
import { jetinnoTimestamp, signFields, verifySignature } from "./signature";
import { EnvelopeSchema, formatIssues } from "./validation";

/**
 * The envelope layer: authenticating what Jetinno sends us, and shaping what we
 * send back (§2.2, §2.3).
 *
 * Every inbound request is rejected unless its MD5 signature verifies against
 * the configured apikey. There is no second credential and no allowlist — the
 * signature is the entire authentication story for this interface, which is
 * why nothing below is permitted to proceed on a soft failure.
 *
 * Every response is HTTP 200, including refusals. The machine reads
 * `returnCode`, not the status line, and a non-2xx makes some firmware retry a
 * request that will never succeed instead of reading the reason we gave.
 */

export interface VerifiedRequest<T> {
  config: JetinnoConfig;
  data: T;
  /** The envelope's own fields, for logging and for echoing identifiers back. */
  envelope: { username: string; time: string };
}

/**
 * Flatten an envelope into the field map §2.4 signs: `username` and `time`
 * from the outside, every member of `data` from the inside, and the name
 * "data" itself nowhere.
 */
function signatureFields(envelope: {
  username: string;
  time: string;
  data: Record<string, unknown>;
}): Record<string, unknown> {
  return { username: envelope.username, time: envelope.time, ...envelope.data };
}

/**
 * Authenticate and validate one inbound message.
 *
 * Order matters: the signature is checked against the RAW data object, before
 * any schema narrowing, so that extension fields a future firmware adds are
 * still part of the string being verified (§2.4 requires exactly this).
 */
export function verifyInbound<S extends z.ZodType>(
  body: unknown,
  dataSchema: S,
  options: { excludeFromSignature?: readonly string[]; env?: Record<string, string | undefined> } = {},
): VerifiedRequest<z.infer<S>> {
  const config = jetinnoConfig(options.env ?? process.env);

  const envelope = EnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new JetinnoError(
      JetinnoCode.PARAM_ERROR,
      `Malformed envelope: ${formatIssues(envelope.error).join("; ")}`,
    );
  }

  if (envelope.data.username !== config.username) {
    // §4.1 has a code for exactly this, and it is not the signature's job.
    throw new JetinnoError(JetinnoCode.USER_NOT_EXIST, "Unknown username");
  }

  const fields = signatureFields(envelope.data);
  if (!verifySignature(envelope.data.sign, fields, config.apikey, {
    exclude: options.excludeFromSignature,
  })) {
    throw new JetinnoError(JetinnoCode.SIGN_ERROR, "Signature does not verify");
  }

  const data = dataSchema.safeParse(envelope.data.data);
  if (!data.success) {
    throw new JetinnoError(
      JetinnoCode.PARAM_ERROR,
      `Invalid business data: ${formatIssues(data.error).join("; ")}`,
    );
  }

  return {
    config,
    data: data.data,
    envelope: { username: envelope.data.username, time: envelope.data.time },
  };
}

/**
 * Build a §2.3 response envelope, signed with the same rule as a request.
 *
 * The specification marks the response `sign` optional and gives no worked
 * example for it, so this signs the response the way it signs a request —
 * `time` plus the members of `data`. A machine that ignores the field loses
 * nothing; one that checks it gets something consistent to check.
 */
export function jetinnoResponse(
  code: string,
  options: { data?: Record<string, unknown>; config?: JetinnoConfig } = {},
): NextResponse {
  const time = jetinnoTimestamp();
  // §2.3: returnCode is SUCCESS or FAIL (max 10 chars); the §4.1 information
  // code travels in msg. The human-readable reason stays in our log.
  const body: JetinnoResponseEnvelope = {
    returnCode: code === JetinnoCode.SUCCESS ? JetinnoCode.SUCCESS : JetinnoCode.FAIL,
    msg: code,
    time,
  };

  if (options.data) {
    body.data = options.data;
    if (options.config) {
      body.sign = signFields({ time, ...options.data }, options.config.apikey);
    }
  }

  return NextResponse.json(body, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/**
 * Map any thrown error onto a §4.1 code and a 200 response.
 *
 * A configuration failure answers SYSTEM_ERROR rather than leaking that the
 * apikey is missing: "need further confirmation" is exactly what a machine
 * should do about it, and the operator reads the real reason in our log.
 */
export function jetinnoErrorResponse(event: string, error: unknown): NextResponse {
  if (error instanceof JetinnoError) {
    logPaymentError(event, { code: error.code, message: error.message });
    return jetinnoResponse(error.code);
  }

  if (error instanceof JetinnoConfigError) {
    logPaymentError(event, { code: JetinnoCode.SYSTEM_ERROR, problems: error.problems });
    return jetinnoResponse(JetinnoCode.SYSTEM_ERROR);
  }

  logPaymentError(event, {
    code: JetinnoCode.SYSTEM_ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
  return jetinnoResponse(JetinnoCode.SYSTEM_ERROR);
}

/** One line per accepted call, so an operator can follow a machine's session. */
export function logJetinno(event: string, data: Record<string, unknown>) {
  logPayment(event, data);
}
