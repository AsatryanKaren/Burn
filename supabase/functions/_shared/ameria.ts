// Ameriabank vPOS (REST API v3-style) adapter logic. Pure module: builds
// requests and interprets responses; the HTTP calls live in payments.ts.
//
// Flow
//   1. InitPayment  POST {base}/api/VPOS/InitPayment
//        { ClientID, Username, Password, Description, OrderID (int), Amount,
//          Currency: "051", BackURL, Opaque }
//      -> { PaymentID, ResponseCode: 1, ResponseMessage }   (1 = success)
//   2. Redirect the buyer to {base}/Payments/Pay?id={PaymentID}&lang={am|en|ru}
//   3. The bank redirects the buyer to BackURL (pay-return-ameria) with query
//      parameters orderID, paymentID, resposneCode (sic), opaque.
//      Query parameters are NOT trusted.
//   4. GetPaymentDetails POST {base}/api/VPOS/GetPaymentDetails
//        { PaymentID, Username, Password }
//      -> { ResponseCode: "00", OrderStatus: 2, Amount, ApprovedAmount,
//           DepositedAmount, Currency, OrderID, Opaque, ... }
//      Paid when ResponseCode == "00", OrderStatus == 2 (deposited), the
//      amount equals the order amount, OrderID equals the id we sent.
//   5. Two-stage terminal only: OrderStatus 1 (approved = amount blocked)
//      -> ConfirmPayment { PaymentID, Username, Password, Amount }
//      -> { ResponseCode: "00" }, then GetPaymentDetails again (now 2).
//
// Checked against "AmeriaBank vPOS 3.1 API Protocol Description":
//   [x] Endpoints, field names, InitPayment success = 1, details success "00".
//   [x] Pay page ?id=&lang=am|ru|en; BackURL params orderID, resposneCode (sic),
//       paymentID, opaque.
//   [x] Currency "051" = AMD (the default). Amount is a decimal; we send whole AMD.
//   [x] Timeout: session seconds, at most 1200 (also the default).
//   [x] OrderStatus (Table 2): 0 started, 1 approved, 2 deposited, 3 void,
//       4 refunded, 5 ACS authorization in progress, 6 declined.
// Still to confirm with the bank when the credentials arrive:
//   [ ] Production base URL (test: https://servicestest.ameriabank.am/VPOS);
//       set AMERIA_API_BASE.
//   [ ] Whether the test terminal needs OrderIDs in a given range ->
//       `alter sequence provider_order_num_seq restart with N`, and the test amount.
//   [ ] Single- or two-stage terminal (both work; two-stage confirms on return).
// ============================================================================

import type { AmeriaCredentials, Lang } from "./types.ts";
import { parseWholeAmd } from "./money.ts";

export const AMERIA_TEST_BASE = "https://servicestest.ameriabank.am/VPOS";
export const AMERIA_CURRENCY_AMD = "051";
/** Seconds the bank page stays open (the manual's maximum and default). */
export const AMERIA_TIMEOUT_S = 1200;

export type { AmeriaCredentials };

export interface HttpRequestSpec {
  url: string;
  body: Record<string, unknown>;
}

function base(apiBase: string): string {
  return apiBase.replace(/\/+$/, "");
}

export function ameriaLanguage(lang: Lang): "am" | "en" | "ru" {
  return lang === "en" ? "en" : lang === "ru" ? "ru" : "am";
}

export function buildInitPaymentRequest(
  creds: AmeriaCredentials,
  p: { orderId: number; amountAmd: number; description: string; backUrl: string; opaque: string },
): HttpRequestSpec {
  if (!Number.isSafeInteger(p.orderId) || p.orderId <= 0) throw new RangeError("orderId must be a positive integer");
  if (!Number.isSafeInteger(p.amountAmd) || p.amountAmd <= 0) throw new RangeError("amount must be a positive integer");
  return {
    url: `${base(creds.apiBase)}/api/VPOS/InitPayment`,
    body: {
      ClientID: creds.clientId,
      Username: creds.username,
      Password: creds.password,
      Description: p.description,
      OrderID: p.orderId,
      Amount: p.amountAmd,
      Currency: AMERIA_CURRENCY_AMD,
      BackURL: p.backUrl,
      Opaque: p.opaque,
      Timeout: AMERIA_TIMEOUT_S,
    },
  };
}

export type InitPaymentOutcome =
  | { ok: true; paymentId: string }
  | { ok: false; responseCode: string; message: string };

export function parseInitPaymentResponse(json: unknown): InitPaymentOutcome {
  const r = (json ?? {}) as Record<string, unknown>;
  const code = String(r.ResponseCode ?? "");
  const paymentId = typeof r.PaymentID === "string" ? r.PaymentID.trim() : "";
  if (code === "1" && paymentId) return { ok: true, paymentId };
  return { ok: false, responseCode: code, message: String(r.ResponseMessage ?? "InitPayment failed") };
}

export function buildPaymentPageUrl(apiBase: string, paymentId: string, lang: Lang): string {
  const q = new URLSearchParams({ id: paymentId, lang: ameriaLanguage(lang) });
  return `${base(apiBase)}/Payments/Pay?${q.toString()}`;
}

export function buildGetPaymentDetailsRequest(creds: AmeriaCredentials, paymentId: string): HttpRequestSpec {
  return {
    url: `${base(creds.apiBase)}/api/VPOS/GetPaymentDetails`,
    body: { PaymentID: paymentId, Username: creds.username, Password: creds.password },
  };
}

/** Two-stage terminals: charges the blocked amount (OrderStatus 1 -> 2). */
export function buildConfirmPaymentRequest(creds: AmeriaCredentials, paymentId: string, amountAmd: number): HttpRequestSpec {
  if (!Number.isSafeInteger(amountAmd) || amountAmd <= 0) throw new RangeError("amount must be a positive integer");
  return {
    url: `${base(creds.apiBase)}/api/VPOS/ConfirmPayment`,
    body: { PaymentID: paymentId, Username: creds.username, Password: creds.password, Amount: amountAmd },
  };
}

/** Returns the money to the card (deposited payments). Amount may be partial. */
export function buildRefundPaymentRequest(creds: AmeriaCredentials, paymentId: string, amountAmd: number): HttpRequestSpec {
  if (!Number.isSafeInteger(amountAmd) || amountAmd <= 0) throw new RangeError("amount must be a positive integer");
  return {
    url: `${base(creds.apiBase)}/api/VPOS/RefundPayment`,
    body: { PaymentID: paymentId, Username: creds.username, Password: creds.password, Amount: amountAmd },
  };
}

/** Cancels (voids) a payment; the bank allows it within 72 hours of InitPayment. */
export function buildCancelPaymentRequest(creds: AmeriaCredentials, paymentId: string): HttpRequestSpec {
  return {
    url: `${base(creds.apiBase)}/api/VPOS/CancelPayment`,
    body: { PaymentID: paymentId, Username: creds.username, Password: creds.password },
  };
}

/** ConfirmPayment / RefundPayment / CancelPayment all answer { ResponseCode: "00" } on success. */
export function parseOperationResponse(json: unknown): { ok: boolean; responseCode: string; message: string } {
  const r = (json ?? {}) as Record<string, unknown>;
  const code = String(r.ResponseCode ?? "");
  return { ok: code === "00", responseCode: code, message: String(r.ResponseMessage ?? "") };
}

export const parseConfirmPaymentResponse = parseOperationResponse;

export interface BackUrlParams {
  paymentId: string | null;
  orderId: string | null;
  responseCode: string | null;
  opaque: string | null;
}

/** Reads the (untrusted) BackURL parameters, tolerating case and the "resposneCode" typo. */
export function parseBackUrlParams(params: URLSearchParams): BackUrlParams {
  const lower = new Map<string, string>();
  for (const [k, v] of params) lower.set(k.toLowerCase(), v);
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const v = lower.get(k.toLowerCase());
      if (v !== undefined && v !== "") return v;
    }
    return null;
  };
  return {
    paymentId: get("paymentID", "paymentId"),
    orderId: get("orderID", "orderId"),
    responseCode: get("resposneCode", "responseCode"),
    opaque: get("opaque"),
  };
}

export type PaymentDetailsVerdict =
  | { paid: true; amountAmd: number }
  | { paid: false; declined: boolean; reason: string; needsConfirm?: true };

/**
 * Decides whether GetPaymentDetails proves that our order was paid.
 * `declined` = the bank reports a final failure (order may be marked failed).
 * `needsConfirm` = two-stage terminal, the right amount is blocked on the card
 * and ConfirmPayment would charge it.
 */
export function evaluatePaymentDetails(
  details: unknown,
  expected: { orderId: number; amountAmd: number },
): PaymentDetailsVerdict {
  const d = (details ?? {}) as Record<string, unknown>;
  const responseCode = String(d.ResponseCode ?? "");
  const orderStatus = String(d.OrderStatus ?? "");

  if (String(d.OrderID ?? "") !== String(expected.orderId)) {
    return { paid: false, declined: false, reason: "ORDER_ID_MISMATCH" };
  }
  if (responseCode !== "00") {
    // 0 = registered (not paid yet), 1 = blocked awaiting confirm, 5 = 3-D Secure in progress: not final.
    const final = !["0", "1", "5", ""].includes(orderStatus);
    return { paid: false, declined: final, reason: `RESPONSE_CODE_${responseCode || "EMPTY"}` };
  }
  if (orderStatus !== "2" && orderStatus !== "1") {
    // 6 declined, 3 void: final. 4 refunded is final too, but never turns a paid order into failed.
    const final = orderStatus === "6" || orderStatus === "3";
    return { paid: false, declined: final, reason: `ORDER_STATUS_${orderStatus || "EMPTY"}` };
  }
  if (
    d.Currency !== undefined && d.Currency !== null &&
    String(d.Currency) !== AMERIA_CURRENCY_AMD && String(d.Currency).toUpperCase() !== "AMD"
  ) {
    return { paid: false, declined: false, reason: "CURRENCY_MISMATCH" };
  }
  const amount = parseWholeAmd(d.Amount);
  if (amount === null || amount !== expected.amountAmd) {
    return { paid: false, declined: false, reason: "AMOUNT_MISMATCH" };
  }
  if (orderStatus === "1") {
    // Nothing is deposited yet; only the blocked amount must match.
    const approved = parseWholeAmd(d.ApprovedAmount);
    if (approved !== null && approved !== expected.amountAmd) {
      return { paid: false, declined: false, reason: "APPROVEDAMOUNT_MISMATCH" };
    }
    return { paid: false, declined: false, reason: "ORDER_STATUS_1", needsConfirm: true };
  }
  for (const key of ["ApprovedAmount", "DepositedAmount"]) {
    if (d[key] === undefined || d[key] === null) continue;
    const v = parseWholeAmd(d[key]);
    if (v === null || v !== expected.amountAmd) return { paid: false, declined: false, reason: `${key.toUpperCase()}_MISMATCH` };
  }
  return { paid: true, amountAmd: amount };
}
