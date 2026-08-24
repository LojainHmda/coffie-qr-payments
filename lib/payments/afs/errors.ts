export type AfsErrorKind =
  | "CONFIG"
  | "NETWORK"
  | "TIMEOUT"
  | "HTTP"
  | "PARSE"
  | "AFS_REJECTED"
  | "VERIFICATION";

/**
 * Error raised by the AFS layer. `publicMessage` is safe to send to the
 * browser; `details` is safe to log (it never contains credentials).
 */
export class AfsError extends Error {
  readonly kind: AfsErrorKind;
  readonly publicMessage: string;
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    kind: AfsErrorKind,
    message: string,
    options: {
      publicMessage?: string;
      httpStatus?: number;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AfsError";
    this.kind = kind;
    this.publicMessage = options.publicMessage ?? message;
    this.httpStatus = options.httpStatus ?? 502;
    this.details = options.details;
  }
}
