// Ameriabank vPOS test console: runs the bank's acceptance test over REST with
// our own adapter (supabase/functions/_shared/ameria.ts).
//
// The bank counts the test as done after at least 5 successful payments,
// 5 refunds and 5 cancellations. Test terminal rules: OrderID within
// AMERIA_ORDER_FROM..AMERIA_ORDER_TO, amount 10 AMD.
//
//   AMERIA_CLIENT_ID=… AMERIA_USERNAME=… AMERIA_PASSWORD=… \
//   AMERIA_ORDER_FROM=30611001 AMERIA_ORDER_TO=30612000 \
//   node --experimental-strip-types tools/ameria/sandbox.ts <state.json>
//
// Then open http://127.0.0.1:8790, press "New payment", pay with the bank's test
// card; the bank returns to this console, which asks GetPaymentDetails.
// Every request and answer is kept in <state.json> (outside the repo).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  AMERIA_TEST_BASE,
  buildCancelPaymentRequest,
  buildGetPaymentDetailsRequest,
  buildInitPaymentRequest,
  buildPaymentPageUrl,
  buildRefundPaymentRequest,
  type HttpRequestSpec,
  parseBackUrlParams,
  parseInitPaymentResponse,
  parseOperationResponse,
} from "../../supabase/functions/_shared/ameria.ts";

const PORT = Number(process.env.PORT ?? 8790);
const AMOUNT = Number(process.env.AMERIA_AMOUNT ?? 10);
const FROM = Number(process.env.AMERIA_ORDER_FROM);
const TO = Number(process.env.AMERIA_ORDER_TO);
const creds = {
  clientId: process.env.AMERIA_CLIENT_ID ?? "",
  username: process.env.AMERIA_USERNAME ?? "",
  password: process.env.AMERIA_PASSWORD ?? "",
  apiBase: process.env.AMERIA_API_BASE ?? AMERIA_TEST_BASE,
};
const statePath = process.argv[2];
if (!creds.clientId || !creds.username || !creds.password || !FROM || !TO || !statePath) {
  console.error("Set AMERIA_CLIENT_ID, AMERIA_USERNAME, AMERIA_PASSWORD, AMERIA_ORDER_FROM, AMERIA_ORDER_TO and pass a state file.");
  process.exit(1);
}

interface Payment {
  orderId: number;
  paymentId: string;
  createdAt: string;
  details?: Record<string, unknown>;
  refunded?: boolean;
  cancelled?: boolean;
  log: { at: string; op: string; response: unknown }[];
}
interface State { nextOrderId: number; payments: Payment[] }

const state: State = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { nextOrderId: FROM, payments: [] };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));

async function post(spec: HttpRequestSpec): Promise<unknown> {
  const res = await fetch(spec.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(spec.body),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

function record(p: Payment, op: string, response: unknown) {
  p.log.push({ at: new Date().toISOString(), op, response });
  save();
}

async function refresh(p: Payment) {
  const d = (await post(buildGetPaymentDetailsRequest(creds, p.paymentId))) as Record<string, unknown>;
  p.details = d;
  record(p, "GetPaymentDetails", d);
}

const STATUS: Record<string, string> = {
  "0": "started", "1": "approved", "2": "deposited (paid)", "3": "void (cancelled)",
  "4": "refunded", "5": "3-D Secure", "6": "declined",
};
const esc = (v: unknown) => String(v ?? "").replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function page(note = ""): string {
  const st = (p: Payment) => String(p.details?.OrderStatus ?? "");
  const paid = state.payments.filter((p) => ["2", "4", "3"].includes(st(p)) && p.details?.ResponseCode === "00" || p.refunded || p.cancelled).length;
  const refunds = state.payments.filter((p) => p.refunded).length;
  const cancels = state.payments.filter((p) => p.cancelled).length;
  const goal = (n: number) => `<b style="color:${n >= 5 ? "#1a7f37" : "#b35900"}">${n} / 5</b>`;
  const rows = state.payments.slice().reverse().map((p) => {
    const s = st(p);
    const canAct = s === "2" && !p.refunded && !p.cancelled;
    return `<tr>
      <td>${p.orderId}</td><td><code>${esc(p.paymentId)}</code></td>
      <td>${esc(STATUS[s] ?? (s || "not paid yet"))}</td><td>${esc(p.details?.ResponseCode)}</td>
      <td>${esc(p.details?.Amount)} / ${esc(p.details?.DepositedAmount)} / ${esc(p.details?.RefundedAmount)}</td>
      <td>
        <form method="post" action="/refresh?id=${p.orderId}"><button>Refresh</button></form>
        ${canAct ? `<form method="post" action="/refund?id=${p.orderId}"><button>Refund</button></form>
        <form method="post" action="/cancel?id=${p.orderId}"><button>Cancel</button></form>` : ""}
        ${s === "0" || !s ? `<a href="${esc(buildPaymentPageUrl(creds.apiBase, p.paymentId, "en"))}">Pay page</a>` : ""}
      </td></tr>`;
  }).join("");
  return `<!doctype html><meta charset="utf-8"><title>vPOS test</title>
  <style>body{font:15px system-ui;margin:24px;max-width:1100px}table{border-collapse:collapse;width:100%}
  td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}form{display:inline}
  button{font:inherit;padding:4px 10px;margin:2px}.big{font-size:17px;padding:10px 18px}.note{background:#fff4d6;padding:10px}</style>
  <h1>Ameriabank vPOS test</h1>
  <p>Successful payments ${goal(paid)} · Refunds ${goal(refunds)} · Cancellations ${goal(cancels)}
   · next OrderID ${state.nextOrderId} · amount ${AMOUNT} AMD</p>
  ${note ? `<p class="note">${esc(note)}</p>` : ""}
  <form method="post" action="/new"><button class="big">New payment →</button></form>
  <table><tr><th>OrderID</th><th>PaymentID</th><th>Status</th><th>Code</th><th>Amount / deposited / refunded</th><th></th></tr>${rows}</table>`;
}

function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
  res.end(body);
}
const home = (res: ServerResponse, note = "") =>
  send(res, 303, "", { Location: "/" + (note ? `?note=${encodeURIComponent(note)}` : "") });

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  const find = () => state.payments.find((p) => p.orderId === Number(url.searchParams.get("id")));

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, page(url.searchParams.get("note") ?? ""));

  if (req.method === "GET" && url.pathname === "/return") {
    const back = parseBackUrlParams(url.searchParams);
    const p = state.payments.find((x) => x.paymentId === back.paymentId) ??
      state.payments.find((x) => String(x.orderId) === back.orderId);
    if (!p) return home(res, `Return for an unknown payment: ${url.search}`);
    record(p, "BackURL", Object.fromEntries(url.searchParams));
    await refresh(p);
    return home(res, `Order ${p.orderId}: bank says ${back.responseCode ?? "?"}, status ${STATUS[String(p.details?.OrderStatus)] ?? "?"}`);
  }

  if (req.method !== "POST") return send(res, 404, "Not found");

  if (url.pathname === "/new") {
    if (state.nextOrderId > TO) return home(res, "The test OrderID range is used up.");
    const orderId = state.nextOrderId++;
    save();
    const r = await post(buildInitPaymentRequest(creds, {
      orderId,
      amountAmd: AMOUNT,
      description: `Test order ${orderId}`,
      backUrl: `http://127.0.0.1:${PORT}/return`,
      opaque: `test-${orderId}`,
    }));
    const out = parseInitPaymentResponse(r);
    if (!out.ok) return home(res, `InitPayment refused for ${orderId}: ${out.responseCode} ${out.message}`);
    const p: Payment = { orderId, paymentId: out.paymentId, createdAt: new Date().toISOString(), log: [] };
    state.payments.push(p);
    record(p, "InitPayment", r);
    return send(res, 303, "", { Location: buildPaymentPageUrl(creds.apiBase, out.paymentId, "en") });
  }

  const p = find();
  if (!p) return home(res, "Unknown payment.");
  if (url.pathname === "/refresh") {
    await refresh(p);
    return home(res);
  }
  if (url.pathname === "/refund" || url.pathname === "/cancel") {
    const refund = url.pathname === "/refund";
    const r = await post(refund
      ? buildRefundPaymentRequest(creds, p.paymentId, AMOUNT)
      : buildCancelPaymentRequest(creds, p.paymentId));
    record(p, refund ? "RefundPayment" : "CancelPayment", r);
    const out = parseOperationResponse(r);
    if (out.ok) refund ? (p.refunded = true) : (p.cancelled = true);
    await refresh(p);
    return home(res, `${refund ? "Refund" : "Cancel"} of ${p.orderId}: ${out.responseCode} ${out.message}`);
  }
  return send(res, 404, "Not found");
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    home(res, `Error: ${String(err).slice(0, 300)}`);
  });
}).listen(PORT, "127.0.0.1", () => console.log(`vPOS test console: http://127.0.0.1:${PORT}`));
