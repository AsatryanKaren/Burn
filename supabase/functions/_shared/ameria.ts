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
//
// ============================================================================
// VERIFY AGAINST AMERIABANK'S SANDBOX DOCUMENTATION BEFORE GOING LIVE
//   [ ] Base URLs: test https://servicestest.ameriabank.am/VPOS, production
//       https://services.ameriabank.am/VPOS (set AMERIA_API_BASE).
//   [ ] Endpoint paths /api/VPOS/InitPayment and /api/VPOS/GetPaymentDetails.
//   [ ] InitPayment success ResponseCode is the number 1 (not "00").
//   [ ] Amount format: number in AMD (we send an integer, e.g. 500). In the
//       test environment the bank may only allow small amounts (e.g. 10 AMD):
//       test with a cheap product price, not by faking the amount.
//   [ ] OrderID: integer, unique per InitPayment; the test terminal may
//       require a specific range -> `alter sequence provider_order_num_seq
//       restart with N`. start-payment allocates a new OrderID on every retry.
//   [ ] Currency "051" (AMD) accepted / required.
//   [ ] lang values on the Pay page: "am", "en", "ru".
//   [ ] BackURL query parameter names (orderID, paymentID, resposneCode, opaque)
//       and whether BackURL may contain its own query string (we don't use one).
//   [ ] GetPaymentDetails field names and types: ResponseCode "00",
//       OrderStatus 2 = deposited (single-stage). If the terminal is
//       two-stage, OrderStatus 1 (approved) needs ConfirmPayment first — we do
//       NOT treat 1 as paid.
//   [ ] Opaque is echoed back in GetPaymentDetails (we use it for the order code).
//   [ ] Whether the bank also sends a server-to-server notification; if so,
//       point it at pay-return-ameria too (it is idempotent).
// ============================================================================

import type { AmeriaCredentials, Lang } from "./types.ts";
import { parseWholeAmd } from "./money.ts";

export const AMERIA_TEST_BASE = "https://servicestest.ameriabank.am/VPOS";
export const AMERIA_CURRENCY_AMD = "051";

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
  | { paid: false; declined: boolean; reason: string };

/**
 * Decides whether GetPaymentDetails proves that our order was paid.
 * `declined` = the bank reports a final failure (order may be marked failed).
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
    // 0 = registered (not paid yet), 5 = 3-D Secure in progress: not final.
    const final = orderStatus !== "0" && orderStatus !== "5" && orderStatus !== "";
    return { paid: false, declined: final, reason: `RESPONSE_CODE_${responseCode || "EMPTY"}` };
  }
  if (orderStatus !== "2") {
    return { paid: false, declined: orderStatus === "6", reason: `ORDER_STATUS_${orderStatus || "EMPTY"}` };
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
  for (const key of ["ApprovedAmount", "DepositedAmount"]) {
    if (d[key] === undefined || d[key] === null) continue;
    const v = parseWholeAmd(d[key]);
    if (v === null || v !== expected.amountAmd) return { paid: false, declined: false, reason: `${key.toUpperCase()}_MISMATCH` };
  }
  return { paid: true, amountAmd: amount };
}
