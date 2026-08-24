import { NextResponse, type NextRequest } from "next/server";

import { AfsError } from "./afs/errors";
import { logPaymentError } from "./log";

/**
 * Turn any thrown error into a response that is useful in development and
 * safe in production: the public message always, internal diagnostics only
 * when NODE_ENV !== "production". Secrets never appear in either.
 */
export function paymentErrorResponse(event: string, error: unknown) {
  const isAfs = error instanceof AfsError;
  const status = isAfs ? error.httpStatus : 500;
  const publicMessage = isAfs ? error.publicMessage : "Unexpected payment error.";

  logPaymentError(event, {
    kind: isAfs ? error.kind : "UNKNOWN",
    message: error instanceof Error ? error.message : String(error),
    details: isAfs ? error.details : undefined,
  });

  const body: Record<string, unknown> = { error: publicMessage };
  if (process.env.NODE_ENV !== "production") {
    body.debug = {
      kind: isAfs ? error.kind : "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
      details: isAfs ? error.details : undefined,
    };
  }

  return NextResponse.json(body, { status });
}

export function badRequest(message: string, problems?: string[]) {
  return NextResponse.json({ error: message, problems }, { status: 400 });
}

/**
 * AFS wants `customer.ip` in IPv4 form for 3-D Secure risk scoring. Local
 * development gives ::1, which is not usable, so it is simply omitted rather
 * than substituted with something untrue.
 */
export function clientIpv4(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const candidate = forwarded || request.headers.get("x-real-ip")?.trim() || null;
  if (!candidate) return null;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(candidate) ? candidate : null;
}

/** Read and JSON-parse a request body, tolerating an empty one. */
export async function readJsonBody(request: NextRequest): Promise<unknown | typeof PARSE_FAILED> {
  const raw = await request.text();
  if (raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return PARSE_FAILED;
  }
}

export const PARSE_FAILED = Symbol("PARSE_FAILED");
