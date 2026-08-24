/** Shapes of the AFS JSON responses we consume. Only documented fields. */

export interface AfsResult {
  code: string;
  description?: string;
  parameterErrors?: Array<{
    name?: string;
    value?: string;
    message?: string;
  }>;
}

/** Response of POST /v1/checkouts */
export interface AfsCheckoutResponse {
  id: string;
  result: AfsResult;
  ndc?: string;
  timestamp?: string;
  buildNumber?: string;
  /** SRI hash of the widget script, returned when `integrity=true` was sent. */
  integrity?: string;
}

/** Response of GET /v1/checkouts/{id}/payment */
export interface AfsPaymentStatusResponse {
  /** AFS transaction id. */
  id?: string;
  paymentType?: string;
  paymentBrand?: string;
  amount?: string;
  currency?: string;
  descriptor?: string;
  merchantTransactionId?: string;
  timestamp?: string;
  result: AfsResult;
  resultDetails?: Record<string, string>;
}

export interface AfsConfig {
  entityId: string;
  accessToken: string;
  /** Always normalised to end with a trailing slash. */
  baseUrl: string;
  currency: string;
  /** Empty until AFS supplies it. */
  webhookDecryptionKey: string | null;
}
