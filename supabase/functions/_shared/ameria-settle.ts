// Settling one Ameriabank payment attempt from the bank's GetPaymentDetails
// answer. Shared by pay-return-ameria (the buyer comes back from the bank)
// and ameria-reconcile (the buyer never came back: closed the tab, lost the
// connection). Pure apart from the injected deps, so every bank answer is
// unit-tested (supabase/tests/reconcile.test.ts).
//
// The rules are the ones pay-return-ameria always had:
//   * paid                      -> confirm_payment (the only way to `paid`);
//                                  ORDER_PAID_BY_OTHER_PAYMENT -> needs_refund
//   * two-stage, amount blocked -> ConfirmPayment, ask again, re-evaluate
//                                  (skipped when the order is already paid)
//   * declined / void           -> order failed (when allowed)
//   * anything else             -> left pending

import {
  evaluatePaymentDetails,
  parseConfirmPaymentResponse,
  type PaymentDetailsVerdict,
} from "./ameria.ts";
import type { PaymentResult } from "./config.ts";
import type { ConfirmResult } from "./db.ts";

export interface SettleDeps {
  paymentDetails(paymentId: string): Promise<Record<string, unknown>>;
  /** Two-stage terminals: ConfirmPayment (charges the blocked amount). */
  confirmBankPayment(paymentId: string, amountAmd: number): Promise<unknown>;
  confirmOrder(code: string, paymentId: string, amountAmd: number): Promise<ConfirmResult>;
  markFailed(code: string): Promise<void>;
  logNeedsRefund(code: string, paymentId: string, amountAmd: number, detail: Record<string, unknown>): Promise<void>;
  /** payment_events row for this order (payload is sanitized by the dep). */
  log(kind: string, code: string, payload: Record<string, unknown>): Promise<void>;
}

export interface SettleOrder {
  code: string;
  status: string;
  amount_amd: number;
}

export interface SettleOptions {
  /** Ameria OrderIDs we sent for this order (current and earlier attempts). */
  knownOrderIds: number[];
  /** False for an older attempt: its decline must not fail a newer one. */
  mayMarkFailed: boolean;
  /** Log an "outcome" row even when nothing changed (the return flow does). */
  logPending: boolean;
}

export interface SettleResult {
  result: PaymentResult;
  verdict: PaymentDetailsVerdict;
  /** The details the verdict is based on (re-read after ConfirmPayment). */
  details: Record<string, unknown>;
}

export async function settleAmeriaPayment(
  deps: SettleDeps,
  order: SettleOrder,
  paymentId: string,
  initialDetails: Record<string, unknown>,
  opts: SettleOptions,
): Promise<SettleResult> {
  let details = initialDetails;
  const bankOrderId = Number(details.OrderID);
  const known = Number.isSafeInteger(bankOrderId) && opts.knownOrderIds.includes(bankOrderId);
  const expected = { orderId: bankOrderId, amountAmd: order.amount_amd };
  let verdict: PaymentDetailsVerdict = known
    ? evaluatePaymentDetails(details, expected)
    : { paid: false, declined: false, reason: "UNKNOWN_ORDER_ID" };

  // Two-stage terminal: the amount is only blocked. Charge it, then ask again.
  // An order that is already paid (by another payment) is left blocked; the bank releases it.
  if (!verdict.paid && verdict.needsConfirm && order.status !== "paid") {
    try {
      const confirm = await deps.confirmBankPayment(paymentId, order.amount_amd);
      const c = parseConfirmPaymentResponse(confirm);
      await deps.log("confirm", order.code, { PaymentID: paymentId, response: confirm });
      if (c.ok) {
        details = await deps.paymentDetails(paymentId);
        await deps.log("details", order.code, { PaymentID: paymentId, details });
        verdict = evaluatePaymentDetails(details, expected);
      }
    } catch (err) {
      console.error("ConfirmPayment failed", err);
      await deps.log("confirm_error", order.code, { PaymentID: paymentId, error: String(err).slice(0, 300) });
    }
  }

  if (verdict.paid) {
    const r = await deps.confirmOrder(order.code, paymentId, verdict.amountAmd);
    await deps.log("outcome", order.code, { PaymentID: paymentId, result: r });
    if (r.ok) return { result: "success", verdict, details };
    console.error("confirm_payment refused", order.code, r.error);
    if (r.error === "ORDER_PAID_BY_OTHER_PAYMENT") {
      await deps.logNeedsRefund(order.code, paymentId, verdict.amountAmd, { reason: r.error });
    }
    return { result: "pending", verdict, details };
  }

  if (verdict.declined && opts.mayMarkFailed) {
    await deps.markFailed(order.code);
    await deps.log("outcome", order.code, { PaymentID: paymentId, result: verdict.reason, declined: true });
    return { result: "failed", verdict, details };
  }
  if (opts.logPending) {
    await deps.log("outcome", order.code, { PaymentID: paymentId, result: verdict.reason, declined: verdict.declined });
  }
  return { result: "pending", verdict, details };
}

// ---------------------------------------------------------------------------
// Reconciliation: attempts whose buyer never came back
// ---------------------------------------------------------------------------

/** Wait this long after InitPayment before asking: the normal return usually comes first. */
export const RECONCILE_MIN_AGE_SECONDS = 180;
/** Stop asking after this long (the bank page itself expires after 20 minutes). */
export const RECONCILE_MAX_AGE_HOURS = 48;
/** At most this many bank lookups per run. */
export const RECONCILE_BATCH = 20;
/**
 * The newest attempt that is still unpaid this long after InitPayment, and
 * that the bank reports as never paid, is abandoned: the order is marked
 * failed (the buyer can pay again). Well past the bank's 20-minute timeout.
 */
export const RECONCILE_ABANDON_MINUTES = 45;

/** One InitPayment of a still-pending order (from ameria_pending_attempts, migration 0018). */
export interface PendingAttempt {
  code: string;
  status: string;
  amount_amd: number;
  provider_order_num: number;
  attempt_order_id: number;
  payment_id: string;
  attempt_at: string;
  /** The newest attempt of the order. */
  latest: boolean;
}

export interface ReconcileDeps extends SettleDeps {
  /** Every Ameria OrderID sent for the order (from the audit log). */
  knownOrderIds(code: string): Promise<number[]>;
}

export interface ReconcileSummary {
  checked: number;
  paid: number;
  failed: number;
  abandoned: number;
  pending: number;
  errors: number;
}

/**
 * The bank never finished this payment: still only registered ("0" or no
 * status) and not a decline we already handle. Status 1 (blocked) and 5
 * (3-D Secure) are left alone: they move on by themselves.
 */
export function isNeverPaid(details: Record<string, unknown>): boolean {
  const s = String(details.OrderStatus ?? "");
  return s === "0" || s === "";
}

export async function reconcileAttempts(
  deps: ReconcileDeps,
  attempts: PendingAttempt[],
  now: Date,
): Promise<ReconcileSummary> {
  const sum: ReconcileSummary = { checked: 0, paid: 0, failed: 0, abandoned: 0, pending: 0, errors: 0 };
  // Status as this run changes it: a paid order still has its other attempts
  // checked (a second paid one is a double charge -> needs_refund).
  const status = new Map<string, string>();
  const known = new Map<string, number[]>();

  for (const a of attempts.slice(0, RECONCILE_BATCH)) {
    if (!a.payment_id) continue;
    sum.checked++;
    try {
      if (!known.has(a.code)) {
        const ids = await deps.knownOrderIds(a.code);
        known.set(a.code, [...new Set([...ids, a.provider_order_num])]);
      }
      const order = { code: a.code, status: status.get(a.code) ?? a.status, amount_amd: a.amount_amd };
      const details = await deps.paymentDetails(a.payment_id);
      const r = await settleAmeriaPayment(deps, order, a.payment_id, details, {
        knownOrderIds: known.get(a.code)!,
        mayMarkFailed: a.latest && order.status === "pending",
        logPending: false,
      });
      if (r.result === "success") {
        status.set(a.code, "paid");
        sum.paid++;
      } else if (r.result === "failed") {
        status.set(a.code, "failed");
        sum.failed++;
      } else if (
        a.latest && order.status === "pending" && isNeverPaid(r.details) &&
        now.getTime() - Date.parse(a.attempt_at) > RECONCILE_ABANDON_MINUTES * 60_000
      ) {
        await deps.markFailed(a.code);
        await deps.log("outcome", a.code, { PaymentID: a.payment_id, result: "ABANDONED" });
        status.set(a.code, "failed");
        sum.abandoned++;
      } else {
        sum.pending++;
      }
    } catch (err) {
      console.error("reconcile failed for", a.code, err);
      sum.errors++;
    }
  }
  return sum;
}
