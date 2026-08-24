/**
 * AFS (Copy&Pay / OPPWA) integration constants.
 *
 * Docs: https://afs.docs.oppwa.com/integrations/widget
 *       https://afs.docs.oppwa.com/reference/parameters
 *       https://afs.docs.oppwa.com/reference/resultCodes
 */

/** Default AFS TEST base URL. Production must be configured via AFS_BASE_URL. */
export const AFS_TEST_BASE_URL = "https://eu-test.oppwa.com/";

/** Prepare Checkout endpoint (server-to-server). */
export const AFS_CHECKOUTS_PATH = "v1/checkouts";

/** Copy&Pay widget script, relative to the configured base URL. */
export const AFS_PAYMENT_WIDGET_SCRIPT_PATH = "v1/paymentWidgets.js";

/**
 * paymentType for a Copy&Pay card payment that is authorised and captured in
 * one step. Valid values per AFS: PA, DB, CD, CP, RV, RF.
 */
export const AFS_PAYMENT_TYPE_DEBIT = "DB";

/** Card brands offered by the widget in this POC. */
export const AFS_WIDGET_BRANDS = "VISA MASTER";

/**
 * POC pricing. The server owns the amount — it is never taken from the client.
 * Replace with real machine/product pricing when the QR flow is built.
 */
export const TEST_PAYMENT_AMOUNT = "5.00";
export const TEST_PAYMENT_CURRENCY = "AED";
export const TEST_PRODUCT_NAME = "Coffee";
export const TEST_MACHINE_ID = "MACHINE-001";

/**
 * Customer and billing details sent with the checkout.
 *
 * 3-D Secure 2 needs these: the Copy&Pay widget supplies the card and browser
 * data itself, but customer/billing must come from the merchant, and a 3DS
 * challenge card fails without them. See
 * https://afs.docs.oppwa.com/tutorials/threeDSecure/3ds-fields
 *
 * These are fixed POC test values. A real machine/QR flow would collect them,
 * or the merchant account would be configured to not require them.
 */
export const TEST_CUSTOMER = {
  "customer.email": "poc-tester@example.com",
  "customer.givenName": "Coffee",
  "customer.surname": "Tester",
  "billing.street1": "Sheikh Zayed Road",
  "billing.city": "Dubai",
  "billing.postcode": "00000",
  "billing.country": "AE",
} as const;

/** Timeout for any server-to-server call to AFS. */
export const AFS_REQUEST_TIMEOUT_MS = 15_000;

/** AFS returns this result code when a checkout was created successfully. */
export const AFS_CHECKOUT_CREATED_CODE = "000.200.100";

/**
 * Result-code classification patterns, taken verbatim from
 * https://afs.docs.oppwa.com/reference/resultCodes
 */
export const AFS_RESULT_PATTERNS = {
  success: /^(000\.000\.|000\.100\.1|000\.[36]|000\.400\.[1][12]0)/,
  successNeedsReview: /^(000\.400\.0[^3]|000\.400\.100)/,
  pending: /^(000\.200)/,
} as const;
