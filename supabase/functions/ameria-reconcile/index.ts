// POST ameria-reconcile — settles Ameriabank payments whose buyer never came
// back to pay-return-ameria (closed the tab, lost the connection, phone died).
// Without it such an order stays pending although the card was charged, and
// after 30 minutes its place could be taken by someone else.
//
// Called every 3 minutes by pg_cron (migration 0018). Takes no input: it asks
// the bank about InitPayments of still-pending orders that are 3 minutes to
// 48 hours old (at most 20 per run) and settles each one exactly as the
// return flow does (settleAmeriaPayment). The newest attempt that the bank
// still reports as never paid 45 minutes after it started is abandoned: the
// order is marked failed and the buyer can pay again.
//
// No secret is needed: the answer always comes from the bank, and a global
// rate limit (2 runs a minute) bounds the bank calls if anyone else calls it.
// Answers { ok, checked, paid, failed, abandoned, pending, errors } or
// { ok, skipped }.

import { getConfig } from "../_shared/env.ts";
import { jsonResponse } from "../_shared/http.ts";
import { ameriaPendingAttempts } from "../_shared/db.ts";
import { ameriaSettleDeps } from "../_shared/payments.ts";
import {
  RECONCILE_BATCH,
  RECONCILE_MAX_AGE_HOURS,
  RECONCILE_MIN_AGE_SECONDS,
  reconcileAttempts,
} from "../_shared/ameria-settle.ts";
import { withinRateLimit } from "../_shared/ratelimit.ts";

const cfg = getConfig();

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }
  try {
    if (cfg.provider !== "ameria" || !cfg.ameria) return jsonResponse({ ok: true, skipped: "AMERIA_OFF" });
    if (!(await withinRateLimit("ameriaReconcile", "global"))) {
      return jsonResponse({ ok: true, skipped: "RATE_LIMITED" }, 429, { "Retry-After": "60" });
    }
    const attempts = await ameriaPendingAttempts(RECONCILE_MIN_AGE_SECONDS, RECONCILE_MAX_AGE_HOURS, RECONCILE_BATCH);
    const summary = await reconcileAttempts(ameriaSettleDeps(cfg, cfg.ameria), attempts, new Date());
    if (summary.paid || summary.failed || summary.abandoned || summary.errors) console.log("ameria-reconcile", summary);
    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    console.error("ameria-reconcile error", err);
    return jsonResponse({ ok: false }, 500);
  }
});
