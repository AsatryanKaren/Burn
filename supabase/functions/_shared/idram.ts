// Idram EDP (Electronic Data Payment) adapter logic. Pure module.
//
// Flow
//   1. create-order / start-payment return
//        payment: { mode: "form", action, method: "POST", fields: {...} }
//      The browser builds a <form method="POST" action=...> with those hidden
//      fields and submits it, which opens Idram's payment page.
//   2. Idram calls our RESULT_URL (pay-callback-idram) twice, POST
//      application/x-www-form-urlencoded:
//        a) precheck: EDP_PRECHECK=YES, EDP_BILL_NO, EDP_REC_ACCOUNT, EDP_AMOUNT
//           -> answer "OK" (text/plain) if the order exists and the amount matches.
//        b) result: EDP_BILL_NO, EDP_REC_ACCOUNT, EDP_PAYER_ACCOUNT, EDP_AMOUNT,
//           EDP_TRANS_ID, EDP_TRANS_DATE, EDP_CHECKSUM
//           -> verify EDP_CHECKSUM = md5(EDP_REC_ACCOUNT:EDP_AMOUNT:SECRET_KEY:
//              EDP_BILL_NO:EDP_PAYER_ACCOUNT:EDP_TRANS_ID:EDP_TRANS_DATE)
//              (case-insensitive), then confirm_payment, then answer "OK".
//   3. Idram sends the buyer to the SUCCESS_URL / FAIL_URL configured in the
//      merchant cabinet (static URLs; see docs/BACKEND.md).
//
// VERIFY AGAINST IDRAM'S CURRENT MERCHANT DOCS BEFORE GOING LIVE
//   - Form action URL (default https://banking.idram.am/Payment/GetPayment).
//   - EDP_LANGUAGE values ("AM" | "RU" | "EN").
//   - Whether EDP_BILL_NO may be alphanumeric; we send the numeric
//     orders.provider_order_num to be safe.
//   - EDP_AMOUNT format in callbacks ("500" vs "500.00"); the checksum uses
//     the string exactly as received, the amount check accepts both.
//   - What Idram does when the result callback does not answer "OK"
//     (we answer non-OK for checksum/amount/order problems).
//   - Whether SUCCESS_URL / FAIL_URL can carry EDP_BILL_NO back to the site.

import type { IdramConfig, Lang } from "./types.ts";
import { md5Hex } from "./md5.ts";
import { timingSafeEqual } from "./strings.ts";
import { parseWholeAmd } from "./money.ts";

export type { IdramConfig };

export interface IdramFormOrder {
  billNo: number | string;
  amountAmd: number;
  description: string;
  lang: Lang;
  email?: string | null;
}

export function idramLanguage(lang: Lang): "AM" | "EN" | "RU" {
  return lang === "en" ? "EN" : lang === "ru" ? "RU" : "AM";
}

export function buildIdramForm(
  cfg: Pick<IdramConfig, "accountId" | "actionUrl">,
  order: IdramFormOrder,
): { mode: "form"; action: string; method: "POST"; fields: Record<string, string> } {
  const fields: Record<string, string> = {
    EDP_LANGUAGE: idramLanguage(order.lang),
    EDP_REC_ACCOUNT: cfg.accountId,
    EDP_DESCRIPTION: order.description,
    EDP_AMOUNT: String(order.amountAmd),
    EDP_BILL_NO: String(order.billNo),
  };
  if (order.email) fields.EDP_EMAIL = order.email;
  return { mode: "form", action: cfg.actionUrl, method: "POST", fields };
}

export type IdramRequestKind = "precheck" | "result" | "invalid";

export function classifyIdramRequest(f: Record<string, string>): IdramRequestKind {
  if (!f.EDP_BILL_NO || !f.EDP_REC_ACCOUNT || !f.EDP_AMOUNT) return "invalid";
  if ((f.EDP_PRECHECK ?? "").toUpperCase() === "YES") return "precheck";
  if (f.EDP_CHECKSUM && f.EDP_TRANS_ID && f.EDP_PAYER_ACCOUNT !== undefined && f.EDP_TRANS_DATE) {
    return "result";
  }
  return "invalid";
}

export function idramChecksum(f: Record<string, string>, secretKey: string): string {
  return md5Hex(
    [
      f.EDP_REC_ACCOUNT,
      f.EDP_AMOUNT,
      secretKey,
      f.EDP_BILL_NO,
      f.EDP_PAYER_ACCOUNT,
      f.EDP_TRANS_ID,
      f.EDP_TRANS_DATE,
    ].map((v) => v ?? "").join(":"),
  );
}

export function verifyIdramChecksum(f: Record<string, string>, secretKey: string): boolean {
  if (!secretKey || !f.EDP_CHECKSUM) return false;
  return timingSafeEqual(idramChecksum(f, secretKey).toLowerCase(), f.EDP_CHECKSUM.trim().toLowerCase());
}

export interface IdramCheckInput {
  fields: Record<string, string>;
  expectedAccount: string;
  /** null when no order matches EDP_BILL_NO. */
  order: { amountAmd: number; payable: boolean } | null;
}

/** Shared checks for precheck and result. Returns null when OK, or a reason. */
export function idramOrderProblem(input: IdramCheckInput): string | null {
  const { fields, expectedAccount, order } = input;
  if (fields.EDP_REC_ACCOUNT !== expectedAccount) return "WRONG_ACCOUNT";
  if (!order) return "ORDER_NOT_FOUND";
  const amount = parseWholeAmd(fields.EDP_AMOUNT);
  if (amount === null || amount !== order.amountAmd) return "AMOUNT_MISMATCH";
  if (!order.payable) return "ORDER_NOT_PAYABLE";
  return null;
}

/** Parses an application/x-www-form-urlencoded body into a flat record. */
export function parseFormBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(body)) out[k] = v;
  return out;
}
