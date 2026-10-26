// API error type and the error codes used across functions. Pure module.
//
// Error response shape (contract): { "error": { "code": "TEXT_TOO_LONG", "message": "..." } }

export const ErrorCode = {
  // generic
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  ORIGIN_NOT_ALLOWED: "ORIGIN_NOT_ALLOWED",
  INVALID_JSON: "INVALID_JSON",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  RATE_LIMITED: "RATE_LIMITED",
  NOT_FOUND: "NOT_FOUND",
  INTERNAL: "INTERNAL",
  // create-order validation
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  INVALID_PRODUCT: "INVALID_PRODUCT",
  PRODUCT_UNAVAILABLE: "PRODUCT_UNAVAILABLE",
  TEXT_REQUIRED: "TEXT_REQUIRED",
  TEXT_TOO_LONG: "TEXT_TOO_LONG",
  WISH_REQUIRED: "WISH_REQUIRED",
  WISH_TOO_LONG: "WISH_TOO_LONG",
  WISH_NOT_ALLOWED: "WISH_NOT_ALLOWED",
  RECIPIENT_REQUIRED: "RECIPIENT_REQUIRED",
  RECIPIENT_TOO_LONG: "RECIPIENT_TOO_LONG",
  RECIPIENT_NOT_ALLOWED: "RECIPIENT_NOT_ALLOWED",
  EMAIL_REQUIRED: "EMAIL_REQUIRED",
  EMAIL_INVALID: "EMAIL_INVALID",
  TEXT_REJECTED: "TEXT_REJECTED",
  // create-order / start-payment: lights on the map
  CELL_INVALID: "CELL_INVALID",
  CELL_TAKEN: "CELL_TAKEN",
  ICON_INVALID: "ICON_INVALID",
  COLOR_INVALID: "COLOR_INVALID",
  SIGNATURE_TOO_LONG: "SIGNATURE_TOO_LONG",
  SIGNATURE_REJECTED: "SIGNATURE_REJECTED",
  // payments
  PAYMENT_UNAVAILABLE: "PAYMENT_UNAVAILABLE",
  PAYMENT_MISCONFIGURED: "PAYMENT_MISCONFIGURED",
  ALREADY_PAID: "ALREADY_PAID",
  ORDER_NOT_PAYABLE: "ORDER_NOT_PAYABLE",
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}
