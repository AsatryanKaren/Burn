import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ameriaLanguage,
  buildGetPaymentDetailsRequest,
  buildInitPaymentRequest,
  buildPaymentPageUrl,
  evaluatePaymentDetails,
  parseBackUrlParams,
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
  // two-stage "approved" is not paid
  const approved = evaluatePaymentDetails({ ...paid, OrderStatus: 1 }, expected);
  assert.deepEqual(approved, { paid: false, declined: false, reason: "ORDER_STATUS_1" });
  // declined
  const declined = evaluatePaymentDetails({ ...paid, ResponseCode: "0116", OrderStatus: 6 }, expected);
  assert.equal(declined.paid, false);
  assert.equal(!declined.paid && declined.declined, true);
  // still in 3-D Secure: not final
  const inProgress = evaluatePaymentDetails({ ...paid, ResponseCode: "", OrderStatus: 5 }, expected);
  assert.equal(!inProgress.paid && inProgress.declined, false);
  assert.equal(evaluatePaymentDetails(null, expected).paid, false);
});
