import { NextResponse, type NextRequest } from "next/server";

import { verifyPaymentByResourcePath } from "@/lib/payments/afs/service";
import { badRequest, paymentErrorResponse } from "@/lib/payments/http";
import { PaymentStatusQuerySchema, formatZodIssues } from "@/lib/validation/payment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/payments/afs/status?resourcePath=/v1/checkouts/{id}/payment
 *
 * Server-side verification of a payment attempt. AFS documents the status
 * lookup as GET {baseUrl}{resourcePath} with the authentication parameters,
 * so this endpoint mirrors that. The browser's opinion of the outcome is
 * never used — only what AFS returns here.
 *
 * AFS allows two status requests per checkout per minute.
 */
export async function GET(request: NextRequest) {
  const parsed = PaymentStatusQuerySchema.safeParse({
    resourcePath: request.nextUrl.searchParams.get("resourcePath") ?? "",
  });

  if (!parsed.success) {
    return badRequest("Invalid status request.", formatZodIssues(parsed.error));
  }

  try {
    const result = await verifyPaymentByResourcePath(parsed.data.resourcePath);
    return NextResponse.json(
      {
        status: result.status,
        amount: result.amount,
        currency: result.currency,
        transactionId: result.transactionId,
        resultCode: result.resultCode,
        resultMessage: result.resultMessage,
        paymentBrand: result.paymentBrand,
        needsManualReview: result.needsManualReview,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return paymentErrorResponse("afs.status.failed", error);
  }
}
