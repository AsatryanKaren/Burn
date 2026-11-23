import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isNeverPaid,
  type PendingAttempt,
  RECONCILE_ABANDON_MINUTES,
  RECONCILE_BATCH,
  reconcileAttempts,
  type ReconcileDeps,
  settleAmeriaPayment,
} from "../functions/_shared/ameria-settle.ts";

const CODE = "0123456789abcdef";
const PAY = "11111111-2222-3333-4444-555555555555";

function paidDetails(orderId: number, amount = 600, extra: Record<string, unknown> = {}) {
  return { OrderID: String(orderId), ResponseCode: "00", OrderStatus: "2", Amount: amount, Currency: "051", ...extra };
}

/** Fake bank + database; `answers` maps PaymentID -> list of GetPaymentDetails answers (in order). */
function fakeDeps(answers: Record<string, Record<string, unknown>[] | Error>, opts: {
  confirmOrder?: (code: string, paymentId: string) => { ok: boolean; error?: string };
  confirmBank?: () => unknown;
  known?: number[];
} = {}) {
  const calls: { op: string; args: unknown[] }[] = [];
  const paidBy = new Map<string, string>();
  const deps: ReconcileDeps = {
    async paymentDetails(paymentId) {
      calls.push({ op: "details", args: [paymentId] });
      const a = answers[paymentId];
      if (a instanceof Error) throw a;
      if (!a || a.length === 0) throw new Error("no answer for " + paymentId);
      return a.length > 1 ? a.shift()! : a[0];
    },
    async confirmBankPayment(paymentId, amount) {
      calls.push({ op: "confirmBank", args: [paymentId, amount] });
      if (opts.confirmBank) return opts.confirmBank();
      return { ResponseCode: "00", ResponseMessage: "OK" };
    },
    async confirmOrder(code, paymentId, amount) {
      calls.push({ op: "confirmOrder", args: [code, paymentId, amount] });
      if (opts.confirmOrder) return { burn_number: null, already: false, ...opts.confirmOrder(code, paymentId) };
      const prev = paidBy.get(code);
      if (prev && prev !== paymentId) return { ok: false, burn_number: null, already: false, error: "ORDER_PAID_BY_OTHER_PAYMENT" };
      paidBy.set(code, paymentId);
      return { ok: true, burn_number: null, already: !!prev };
    },
    async markFailed(code) { calls.push({ op: "markFailed", args: [code] }); },
    async logNeedsRefund(code, paymentId, amount, detail) { calls.push({ op: "needsRefund", args: [code, paymentId, amount, detail] }); },
    async log(kind, code, payload) { calls.push({ op: "log:" + kind, args: [code, payload] }); },
    async knownOrderIds() { return opts.known ?? []; },
  };
  return { deps, calls, ops: () => calls.map((c) => c.op) };
}

const order = (status = "pending") => ({ code: CODE, status, amount_amd: 600 });
const settleOpts = { knownOrderIds: [5001], mayMarkFailed: true, logPending: true };

// ---------------------------------------------------------------------------
// settleAmeriaPayment
// ---------------------------------------------------------------------------

test("settle: paid with the right amount confirms the order", async () => {
  const f = fakeDeps({});
  const r = await settleAmeriaPayment(f.deps, order(), PAY, paidDetails(5001), settleOpts);
  assert.equal(r.result, "success");
  assert.deepEqual(f.ops(), ["confirmOrder", "log:outcome"]);
  assert.deepEqual(f.calls[0].args, [CODE, PAY, 600]);
});

test("settle: a second paid payment for a paid order is flagged for a bank refund", async () => {
  const f = fakeDeps({}, { confirmOrder: () => ({ ok: false, error: "ORDER_PAID_BY_OTHER_PAYMENT" }) });
  const r = await settleAmeriaPayment(f.deps, order("paid"), PAY, paidDetails(5001), settleOpts);
  assert.equal(r.result, "pending");
  assert.deepEqual(f.ops(), ["confirmOrder", "log:outcome", "needsRefund"]);
});

test("settle: two-stage blocked amount is confirmed at the bank, then the order", async () => {
  const f = fakeDeps({ [PAY]: [paidDetails(5001)] });
  const blocked = { OrderID: "5001", ResponseCode: "00", OrderStatus: "1", Amount: 600, ApprovedAmount: 600 };
  const r = await settleAmeriaPayment(f.deps, order(), PAY, blocked, settleOpts);
  assert.equal(r.result, "success");
  assert.deepEqual(f.ops(), ["confirmBank", "log:confirm", "details", "log:details", "confirmOrder", "log:outcome"]);
});

test("settle: a blocked amount is not charged when the order is already paid", async () => {
  const f = fakeDeps({});
  const blocked = { OrderID: "5001", ResponseCode: "00", OrderStatus: "1", Amount: 600 };
  const r = await settleAmeriaPayment(f.deps, order("paid"), PAY, blocked, settleOpts);
  assert.equal(r.result, "pending");
  assert.ok(!f.ops().includes("confirmBank"));
});

test("settle: ConfirmPayment refused or failing leaves the order pending", async () => {
  const blocked = { OrderID: "5001", ResponseCode: "00", OrderStatus: "1", Amount: 600 };
  const refused = fakeDeps({}, { confirmBank: () => ({ ResponseCode: "0-2000", ResponseMessage: "no" }) });
  assert.equal((await settleAmeriaPayment(refused.deps, order(), PAY, blocked, settleOpts)).result, "pending");
  assert.ok(!refused.ops().includes("confirmOrder"));
  const broken = fakeDeps({}, { confirmBank: () => { throw new Error("timeout"); } });
  assert.equal((await settleAmeriaPayment(broken.deps, order(), PAY, blocked, settleOpts)).result, "pending");
  assert.ok(broken.ops().includes("log:confirm_error"));
});

test("settle: declined fails the order only when allowed", async () => {
  const declined = { OrderID: "5001", ResponseCode: "00", OrderStatus: "6", Amount: 600 };
  const f = fakeDeps({});
  assert.equal((await settleAmeriaPayment(f.deps, order(), PAY, declined, settleOpts)).result, "failed");
  assert.deepEqual(f.ops(), ["markFailed", "log:outcome"]);
  const g = fakeDeps({});
  const r = await settleAmeriaPayment(g.deps, order(), PAY, declined, { ...settleOpts, mayMarkFailed: false, logPending: false });
  assert.equal(r.result, "pending");
  assert.deepEqual(g.ops(), []);
});

test("settle: unknown OrderID, wrong amount or wrong currency never confirm", async () => {
  for (const d of [paidDetails(9999), paidDetails(5001, 10), paidDetails(5001, 600, { Currency: "840" })]) {
    const f = fakeDeps({});
    const r = await settleAmeriaPayment(f.deps, order(), PAY, d, settleOpts);
    assert.equal(r.result, "pending", JSON.stringify(d));
    assert.ok(!f.ops().includes("confirmOrder"));
    assert.ok(!f.ops().includes("markFailed"));
  }
});

// ---------------------------------------------------------------------------
// reconcileAttempts
// ---------------------------------------------------------------------------

const NOW = new Date("2026-12-20T12:00:00Z");
function attempt(over: Partial<PendingAttempt> = {}): PendingAttempt {
  return {
    code: CODE, status: "pending", amount_amd: 600, provider_order_num: 5001, attempt_order_id: 5001,
    payment_id: PAY, attempt_at: new Date(NOW.getTime() - 10 * 60_000).toISOString(), latest: true, ...over,
  };
}
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const neverPaid = { OrderID: "5001", ResponseCode: "0-1", OrderStatus: "0", Amount: 600 };

test("reconcile: a buyer who paid and never came back gets the order confirmed", async () => {
  const f = fakeDeps({ [PAY]: [paidDetails(5001)] });
  const s = await reconcileAttempts(f.deps, [attempt()], NOW);
  assert.deepEqual(s, { checked: 1, paid: 1, failed: 0, abandoned: 0, pending: 0, errors: 0 });
  assert.ok(f.ops().includes("confirmOrder"));
});

test("reconcile: never paid, newest attempt, past the abandon time -> order failed", async () => {
  const f = fakeDeps({ [PAY]: [neverPaid] });
  const s = await reconcileAttempts(f.deps, [attempt({ attempt_at: minutesAgo(RECONCILE_ABANDON_MINUTES + 1) })], NOW);
  assert.equal(s.abandoned, 1);
  assert.deepEqual(f.ops(), ["details", "markFailed", "log:outcome"]);
});

test("reconcile: never paid but still young, or not the newest attempt -> left alone", async () => {
  const young = fakeDeps({ [PAY]: [neverPaid] });
  assert.equal((await reconcileAttempts(young.deps, [attempt({ attempt_at: minutesAgo(20) })], NOW)).pending, 1);
  assert.ok(!young.ops().includes("markFailed"));
  const older = fakeDeps({ [PAY]: [neverPaid] });
  assert.equal((await reconcileAttempts(older.deps, [attempt({ latest: false, attempt_at: minutesAgo(300) })], NOW)).pending, 1);
  assert.ok(!older.ops().includes("markFailed"));
});

test("reconcile: 3-D Secure or blocked-but-unconfirmable is never abandoned", async () => {
  for (const st of ["5", "1"]) {
    const f = fakeDeps({ [PAY]: [{ OrderID: "5001", ResponseCode: "0-1", OrderStatus: st, Amount: 600 }] });
    const s = await reconcileAttempts(f.deps, [attempt({ attempt_at: minutesAgo(600) })], NOW);
    assert.equal(s.abandoned, 0, st);
    assert.ok(!f.ops().includes("markFailed"), st);
  }
});

test("reconcile: a declined older attempt does not fail the order", async () => {
  const f = fakeDeps({ [PAY]: [{ OrderID: "5001", ResponseCode: "00", OrderStatus: "6", Amount: 600 }] });
  const s = await reconcileAttempts(f.deps, [attempt({ latest: false })], NOW);
  assert.equal(s.failed, 0);
  assert.ok(!f.ops().includes("markFailed"));
});

test("reconcile: two paid attempts for one order -> one confirmed, one needs a refund", async () => {
  const PAY2 = "22222222-2222-3333-4444-555555555555";
  const f = fakeDeps({ [PAY]: [paidDetails(5001)], [PAY2]: [paidDetails(5002)] }, { known: [5001, 5002] });
  const s = await reconcileAttempts(f.deps, [
    attempt({ latest: false, attempt_order_id: 5001 }),
    attempt({ payment_id: PAY2, attempt_order_id: 5002, provider_order_num: 5002 }),
  ], NOW);
  assert.equal(s.paid, 1);
  assert.equal(f.ops().filter((o) => o === "needsRefund").length, 1);
});

test("reconcile: a bank error on one attempt does not stop the others", async () => {
  const PAY2 = "33333333-2222-3333-4444-555555555555";
  const f = fakeDeps({ [PAY]: new Error("bank down"), [PAY2]: [paidDetails(6001)] });
  const s = await reconcileAttempts(f.deps, [
    attempt(),
    attempt({ code: "fedcba9876543210", payment_id: PAY2, attempt_order_id: 6001, provider_order_num: 6001 }),
  ], NOW);
  assert.equal(s.errors, 1);
  assert.equal(s.paid, 1);
});

test("reconcile: at most RECONCILE_BATCH bank lookups per run", async () => {
  const many = Array.from({ length: RECONCILE_BATCH + 5 }, (_, i) =>
    attempt({ code: String(i).padStart(16, "0"), payment_id: `aaaaaaaa-0000-0000-0000-${String(i).padStart(12, "0")}` }));
  const answers = Object.fromEntries(many.map((a) => [a.payment_id, [neverPaid]]));
  const f = fakeDeps(answers);
  const s = await reconcileAttempts(f.deps, many, NOW);
  assert.equal(s.checked, RECONCILE_BATCH);
  assert.equal(f.ops().filter((o) => o === "details").length, RECONCILE_BATCH);
});

test("isNeverPaid: only registered-but-unpaid", () => {
  assert.equal(isNeverPaid({ OrderStatus: "0" }), true);
  assert.equal(isNeverPaid({}), true);
  for (const s of ["1", "2", "3", "4", "5", "6"]) assert.equal(isNeverPaid({ OrderStatus: s }), false, s);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("migration 0018: helper is service_role only and the cron job calls ameria-reconcile", () => {
  const sql = readFileSync(new URL("../migrations/0018_ameria_reconcile.sql", import.meta.url), "utf8");
  assert.match(sql, /revoke all on function public\.ameria_pending_attempts\(integer, integer, integer\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.ameria_pending_attempts\(integer, integer, integer\) to service_role/);
  assert.match(sql, /cron\.schedule\(\s*'ameria-reconcile',\s*'\*\/3 \* \* \* \*'/);
  assert.match(sql, /functions\/v1\/ameria-reconcile/);
  assert.match(sql, /o\.status = 'pending'/);
});

test("config.toml: ameria-reconcile has verify_jwt = false (pg_cron sends no JWT)", () => {
  const toml = readFileSync(new URL("../config.toml", import.meta.url), "utf8");
  assert.match(toml, /\[functions\.ameria-reconcile\]\s*\nverify_jwt = false/);
});

test("pay-return-ameria settles through the shared settleAmeriaPayment", () => {
  const src = readFileSync(new URL("../functions/pay-return-ameria/index.ts", import.meta.url), "utf8");
  assert.match(src, /settleAmeriaPayment\(/);
  assert.doesNotMatch(src, /confirmPayment\(/);
});
