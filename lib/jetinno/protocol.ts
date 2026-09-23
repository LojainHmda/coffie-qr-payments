/**
 * Jetinno IOT Payment Universal Interface — wire vocabulary (spec A5).
 *
 * Direction matters and is easy to get backwards, so it is stated once here:
 *
 *   Jetinno calls US           we call THEM
 *   ----------------           ------------
 *   POST /getQrCode    §3.1     POST notifyUrl   §3.3
 *   POST /payBarCode   §3.2
 *   POST /refund       §3.4
 *   POST /productdone  §3.5
 *
 * The machine is the client. It prices the basket from its own catalogue and
 * asks us only for something to put on the screen; we answer with a string and
 * it draws the QR. Our server never commands the machine — it reports a
 * payment result to the callback address the machine supplied.
 */

/** §4.1 Information codes. SUCCESS is the only non-error value. */
export const JetinnoCode = {
  SUCCESS: "SUCCESS",
  FAIL: "FAIL",
  SYSTEM_ERROR: "SYSTEM_ERROR",
  PARAM_ERROR: "PARAM_ERROR",
  INVALID_REQUEST: "INVALID_REQUEST",
  USER_NOT_EXIST: "USER_NOT_EXIST",
  SIGN_ERROR: "SIGN_ERROR",
  PAYCODE_EXPIRE: "PAYCODE_EXPIRE",
  PAYCODE_INVALID: "PAYCODE_INVALID",
  USERPAYING: "USERPAYING",
  ORDER_PAY: "ORDER_PAY",
  ORDERNO_EXIST: "ORDERNO_EXIST",
  ORDER_CLOSED: "ORDER_CLOSED",
  ORDER_NOT_EXIST: "ORDER_NOT_EXIST",
  REVERSE_EXPIRE: "REVERSE_EXPIRE",
  TRADE_ERROR: "TRADE_ERROR",
  REFUND_OVERDUE: "REFUND_OVERDUE",
  REFUNDNO_EXIST: "REFUNDNO_EXIST",
} as const;

export type JetinnoCode = (typeof JetinnoCode)[keyof typeof JetinnoCode];

/**
 * §3.2.3 order transaction status, as reported back to a scanning machine.
 *
 * PAYING is the one that shapes our design: it means "not decided yet, expect
 * the answer on the callback", which is exactly the position a card payment
 * leaves us in while the customer is still on the 3-D Secure page.
 */
export const JetinnoPayStatus = {
  PAYING: "PAYING",
  PAYSUCCESS: "PAYSUCCESS",
  PAYERROR: "PAYERROR",
  UNENOUGH: "UNENOUGH",
} as const;

export type JetinnoPayStatus = (typeof JetinnoPayStatus)[keyof typeof JetinnoPayStatus];

/** §3.4.3 refund transaction status. */
export const JetinnoRefundState = {
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
} as const;

export type JetinnoRefundState = (typeof JetinnoRefundState)[keyof typeof JetinnoRefundState];

/** §3.5.2 order completion status — did the machine actually make the drink. */
export const JetinnoFinishState = {
  SUCCESS: "SUCCESS",
  ERROR: "ERROR",
} as const;

export type JetinnoFinishState = (typeof JetinnoFinishState)[keyof typeof JetinnoFinishState];

/**
 * §3.1.2 payment types. We take a card on a web page, which is none of their
 * rails exactly; jn_qr (1001) is the honest description of what the machine
 * shows and of what the customer then does.
 */
export const JetinnoPayType = {
  QR: "1001",
  BARCODE: "1002",
  CARD: "1003",
  CASH: "1004",
} as const;

/**
 * §3.1.3 caps qrCode at 128 characters. That single number is what makes this
 * integration possible without a gateway-issued QR: a pay URL fits inside it,
 * so the string we hand back can simply be our own payment page.
 */
export const QR_CODE_MAX_LENGTH = 128;

/** §2.1 — the machine gives up on us after 8 seconds. */
export const RESPONSE_TIMEOUT_MS = 8_000;

/** The envelope every message in both directions uses (§2.2, §2.3). */
export interface JetinnoEnvelope {
  username: string;
  time: string;
  sign: string;
  data?: Record<string, unknown>;
}

export interface JetinnoResponseEnvelope {
  returnCode: string;
  msg: string;
  time: string;
  sign?: string;
  data?: Record<string, unknown>;
}
