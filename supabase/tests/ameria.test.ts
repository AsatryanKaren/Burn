import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ameriaLanguage,
  buildCancelPaymentRequest,
  buildConfirmPaymentRequest,
  buildGetPaymentDetailsRequest,
  buildInitPaymentRequest,
  buildPaymentPageUrl,
  buildRefundPaymentRequest,
  evaluatePaymentDetails,
  parseBackUrlParams,
  parseConfirmPaymentResponse,
  parseInitPaymentResponse,
} from "../functions/_shared/ameria.ts";

const creds = {
  clientId: "client-guid",
  username: "user",
  password: "pass",
  apiBase: "https://servicestest.ameriabank.am/VPOS/",
};

test("InitPayment request", () => {
  const spec = buildInitPaymentRequest(creds, {
    orderId: 100001,
    amountAmd: 500,
    description: "Order 100001",
    backUrl: "https://ref.supabase.co/functions/v1/pay-return-ameria",
    opaque: "abcdefghjk012345",
  });
  assert.equal(spec.url, "https://servicestest.ameriabank.am/VPOS/api/VPOS/InitPayment");
  assert.deepEqual(spec.body, {
    ClientID: "client-guid",
    Username: "user",
    Password: "pass",
    Description: "Order 100001",
    OrderID: 100001,
    Amount: 500,
    Currency: "051",
    BackURL: "https://ref.supabase.co/functions/v1/pay-return-ameria",
    Opaque: "abcdefghjk012345",
    Timeout: 1200,
  });
  assert.throws(() => buildInitPaymentRequest(creds, { orderId: 1.5, amountAmd: 500, description: "", backUrl: "", opaque: "" }));
  assert.throws(() => buildInitPaymentRequest(creds, { orderId: 1, amountAmd: 0, description: "", backUrl: "", opaque: "" }));
});

test("InitPayment response parsing", () => {
  assert.deepEqual(parseInitPaymentResponse({ PaymentID: "pid-123", ResponseCode: 1, ResponseMessage: "OK" }), {
    ok: true,
    paymentId: "pid-123",
  });
  const bad = parseInitPaymentResponse({ PaymentID: null, ResponseCode: 4, ResponseMessage: "Invalid OrderID" });
  assert.equal(bad.ok, false);
  assert.equal(parseInitPaymentResponse(null).ok, false);
});

test("payment page URL and language", () => {
  assert.equal(
    buildPaymentPageUrl(creds.apiBase, "pid-123", "hy"),
    "https://servicestest.ameriabank.am/VPOS/Payments/Pay?id=pid-123&lang=am",
  );
  assert.equal(ameriaLanguage("en"), "en");
  assert.equal(ameriaLanguage("ru"), "ru");
});

test("GetPaymentDetails request", () => {
  assert.deepEqual(buildGetPaymentDetailsRequest(creds, "pid-123"), {
    url: "https://servicestest.ameriabank.am/VPOS/api/VPOS/GetPaymentDetails",
    body: { PaymentID: "pid-123", Username: "user", Password: "pass" },
  });
});

test("BackURL params tolerate the resposneCode typo", () => {
  const p = parseBackUrlParams(new URLSearchParams("orderID=100001&resposneCode=00&paymentID=pid-1&opaque=abc"));
  assert.deepEqual(p, { orderId: "100001", responseCode: "00", paymentId: "pid-1", opaque: "abc" });
  assert.equal(parseBackUrlParams(new URLSearchParams("")).paymentId, null);
});

const paid = {
  ResponseCode: "00",
  OrderStatus: 2,
  OrderID: "100001",
  Amount: 500.0,
  ApprovedAmount: 500,
  DepositedAmount: 500,
  Currency: "051",
};
const expected = { orderId: 100001, amountAmd: 500 };

test("payment details: paid", () => {
  assert.deepEqual(evaluatePaymentDetails(paid, expected), { paid: true, amountAmd: 500 });
});

test("payment details: refusals", () => {
  assert.equal(evaluatePaymentDetails({ ...paid, Amount: 5 }, expected).paid, false);
  assert.equal(evaluatePaymentDetails({ ...paid, DepositedAmount: 0 }, expected).paid, false);
  assert.equal(evaluatePaymentDetails({ ...paid, OrderID: "100002" }, expected).paid, false);
  assert.equal(evaluatePaymentDetails({ ...paid, Currency: "840" }, expected).paid, false);
  // void is final
  const voided = evaluatePaymentDetails({ ...paid, OrderStatus: 3 }, expected);
  assert.equal(!voided.paid && voided.declined, true);
  // refunded is not paid, but never marks the order failed
  const refunded = evaluatePaymentDetails({ ...paid, OrderStatus: 4 }, expected);
  assert.equal(!refunded.paid && refunded.declined, false);
  // declined
  const declined = evaluatePaymentDetails({ ...paid, ResponseCode: "0116", OrderStatus: 6 }, expected);
  assert.equal(declined.paid, false);
  assert.equal(!declined.paid && declined.declined, true);
  // still in 3-D Secure: not final
  const inProgress = evaluatePaymentDetails({ ...paid, ResponseCode: "", OrderStatus: 5 }, expected);
  assert.equal(!inProgress.paid && inProgress.declined, false);
  assert.equal(evaluatePaymentDetails(null, expected).paid, false);
});

test("two-stage: approved needs ConfirmPayment, never counts as paid", () => {
  const blocked = { ...paid, OrderStatus: 1, DepositedAmount: 0 };
  assert.deepEqual(evaluatePaymentDetails(blocked, expected), {
    paid: false, declined: false, reason: "ORDER_STATUS_1", needsConfirm: true,
  });
  assert.equal(evaluatePaymentDetails({ ...blocked, ApprovedAmount: 5 }, expected).paid, false);
  assert.equal("needsConfirm" in evaluatePaymentDetails({ ...blocked, ApprovedAmount: 5 }, expected), false);
  assert.equal("needsConfirm" in evaluatePaymentDetails({ ...blocked, Amount: 5 }, expected), false);
  assert.equal("needsConfirm" in evaluatePaymentDetails({ ...blocked, OrderID: "9" }, expected), false);
  // a non-"00" code while blocked is not a final failure
  const odd = evaluatePaymentDetails({ ...blocked, ResponseCode: "0-9000" }, expected);
  assert.equal(!odd.paid && odd.declined, false);
});

test("ConfirmPayment request and response", () => {
  assert.deepEqual(buildConfirmPaymentRequest(creds, "pid-123", 500), {
    url: "https://servicestest.ameriabank.am/VPOS/api/VPOS/ConfirmPayment",
    body: { PaymentID: "pid-123", Username: "user", Password: "pass", Amount: 500 },
  });
  assert.throws(() => buildConfirmPaymentRequest(creds, "pid-123", 0));
  assert.deepEqual(parseConfirmPaymentResponse({ ResponseCode: "00", ResponseMessage: "OK" }), { ok: true, responseCode: "00", message: "OK" });
  assert.equal(parseConfirmPaymentResponse({ ResponseCode: "0-2012" }).ok, false);
  assert.equal(parseConfirmPaymentResponse(null).ok, false);
});

test("RefundPayment and CancelPayment requests", () => {
  assert.deepEqual(buildRefundPaymentRequest(creds, "pid-123", 10), {
    url: "https://servicestest.ameriabank.am/VPOS/api/VPOS/RefundPayment",
    body: { PaymentID: "pid-123", Username: "user", Password: "pass", Amount: 10 },
  });
  assert.throws(() => buildRefundPaymentRequest(creds, "pid-123", 2.5));
  assert.deepEqual(buildCancelPaymentRequest(creds, "pid-123"), {
    url: "https://servicestest.ameriabank.am/VPOS/api/VPOS/CancelPayment",
    body: { PaymentID: "pid-123", Username: "user", Password: "pass" },
  });
});
