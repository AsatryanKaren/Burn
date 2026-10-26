// Payment provider adapters (impure: Ameria needs an HTTP call).
//
//   disabled -> { mode: "disabled" }                    nothing is charged
//   mock     -> { mode: "mock", url: pay-mock?code=… }  test only
//   ameria   -> { mode: "redirect", url: bank page }    after InitPayment
//   idram    -> { mode: "form", action, method, fields } browser POSTs the form

import type { Config } from "./config.ts";
import { ameriaBackUrl, mockPayUrl, paymentDescription } from "./config.ts";
import type { Lang, PaymentInstruction } from "./types.ts";
import { ApiError, ErrorCode } from "./errors.ts";
import {
  type AmeriaCredentials,
  buildGetPaymentDetailsRequest,
  buildInitPaymentRequest,
  buildPaymentPageUrl,
  type HttpRequestSpec,
  parseInitPaymentResponse,
} from "./ameria.ts";
import { buildIdramForm } from "./idram.ts";
import { logPaymentEvent, markOrderFailed } from "./db.ts";
import { sanitizePayload, saltedHasher } from "./sanitize.ts";

export const PROVIDER_TIMEOUT_MS = 15_000;

export interface PayableOrder {
  code: string;
  amount_amd: number;
  provider_order_num: number;
  lang: Lang;
  email: string | null;
}

/** POSTs JSON to the bank with a timeout. Throws on network errors / non-JSON. */
export async function postJson(spec: HttpRequestSpec, timeoutMs = PROVIDER_TIMEOUT_MS): Promise<unknown> {
  const res = await fetch(spec.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(spec.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(spec.url).pathname}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

export async function sanitizeForLog(cfg: Config, payload: unknown): Promise<unknown> {
  return sanitizePayload(payload, saltedHasher(cfg.ipHashSalt));
}

/**
 * Produces the payment instruction for an order that is already `pending`
 * with this provider (create-order inserts it so; start-payment calls
 * begin_payment_attempt first). `lang` is the language of the bank page.
 */
export async function paymentInstruction(cfg: Config, order: PayableOrder, lang: Lang): Promise<PaymentInstruction> {
  switch (cfg.provider) {
    case "disabled":
      return { mode: "disabled" };

    case "mock":
      return { mode: "mock", url: mockPayUrl(cfg.functionsBase, order.code) };

    case "idram": {
      if (!cfg.idram) throw paymentMisconfiguredError();
      return buildIdramForm(cfg.idram, {
        billNo: order.provider_order_num,
        amountAmd: order.amount_amd,
        description: paymentDescription(order.provider_order_num),
        lang,
        email: order.email,
      });
    }

    case "ameria": {
      if (!cfg.ameria) throw paymentMisconfiguredError();
      const paymentId = await ameriaInit(cfg, cfg.ameria, order);
      return { mode: "redirect", url: buildPaymentPageUrl(cfg.ameria.apiBase, paymentId, lang) };
    }
  }
}

async function ameriaInit(cfg: Config, creds: AmeriaCredentials, order: PayableOrder): Promise<string> {
  const spec = buildInitPaymentRequest(creds, {
    orderId: order.provider_order_num,
    amountAmd: order.amount_amd,
    description: paymentDescription(order.provider_order_num),
    backUrl: ameriaBackUrl(cfg.functionsBase),
    opaque: order.code,
  });

  let response: unknown;
  try {
    response = await postJson(spec);
  } catch (err) {
    console.error("ameria InitPayment failed", err);
    await logPaymentEvent("ameria", "init_error", order.code, {
      OrderID: order.provider_order_num,
      error: String(err).slice(0, 300),
    });
    await markOrderFailed(order.code);
    throw paymentUnavailableError();
  }

  const outcome = parseInitPaymentResponse(response);
  // The init event links OrderID <-> order code; pay-return-ameria relies on it.
  await logPaymentEvent("ameria", outcome.ok ? "init" : "init_error", order.code, {
    OrderID: order.provider_order_num,
    Amount: order.amount_amd,
    response: await sanitizeForLog(cfg, response),
  });
  if (!outcome.ok) {
    console.error("ameria InitPayment refused", outcome.responseCode, outcome.message);
    await markOrderFailed(order.code);
    throw paymentUnavailableError();
  }
  return outcome.paymentId;
}

export async function ameriaPaymentDetails(creds: AmeriaCredentials, paymentId: string): Promise<unknown> {
  return postJson(buildGetPaymentDetailsRequest(creds, paymentId));
}

export function paymentUnavailableError(): ApiError {
  return new ApiError(502, ErrorCode.PAYMENT_UNAVAILABLE, "The payment service is not responding. Please try again.");
}

export function paymentMisconfiguredError(): ApiError {
  return new ApiError(503, ErrorCode.PAYMENT_MISCONFIGURED, "Payments are temporarily unavailable.");
}
