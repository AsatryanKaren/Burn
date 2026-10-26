import { test } from "node:test";
import assert from "node:assert/strict";
import { md5Hex } from "../functions/_shared/md5.ts";
import {
  buildIdramForm,
  classifyIdramRequest,
  idramChecksum,
  idramLanguage,
  idramOrderProblem,
  parseFormBody,
  verifyIdramChecksum,
} from "../functions/_shared/idram.ts";

test("md5 matches RFC 1321 / reference vectors", () => {
  assert.equal(md5Hex(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.equal(md5Hex("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.equal(md5Hex("The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
  assert.equal(md5Hex("Թող մնա 2026-ում"), "84dce9d405a1e28b69307f04aa973bff");
  assert.equal(md5Hex("x".repeat(1000)), "398533d48111e9f664b1f64cb10c4b63");
});

const result = {
  EDP_REC_ACCOUNT: "123456",
  EDP_AMOUNT: "500.00",
  EDP_BILL_NO: "100001",
  EDP_PAYER_ACCOUNT: "987654321",
  EDP_TRANS_ID: "5551234",
  EDP_TRANS_DATE: "2026-12-31 23:59:59",
  EDP_CHECKSUM: "FA0ECB0F8611901ADF69B0AFE2522C25",
};

test("idram checksum = md5(REC:AMOUNT:SECRET:BILL:PAYER:TRANS_ID:TRANS_DATE)", () => {
  assert.equal(idramChecksum(result, "SECRET"), "fa0ecb0f8611901adf69b0afe2522c25");
});

test("idram checksum comparison is case-insensitive and rejects tampering", () => {
  assert.equal(verifyIdramChecksum(result, "SECRET"), true);
  assert.equal(verifyIdramChecksum({ ...result, EDP_CHECKSUM: result.EDP_CHECKSUM.toLowerCase() }, "SECRET"), true);
  assert.equal(verifyIdramChecksum(result, "WRONG"), false);
  assert.equal(verifyIdramChecksum({ ...result, EDP_AMOUNT: "5.00" }, "SECRET"), false);
  assert.equal(verifyIdramChecksum({ ...result, EDP_CHECKSUM: "" }, "SECRET"), false);
  assert.equal(verifyIdramChecksum(result, ""), false);
});

test("classifies precheck, result and invalid requests", () => {
  assert.equal(
    classifyIdramRequest({ EDP_PRECHECK: "YES", EDP_BILL_NO: "1", EDP_REC_ACCOUNT: "2", EDP_AMOUNT: "500" }),
    "precheck",
  );
  assert.equal(classifyIdramRequest(result), "result");
  assert.equal(classifyIdramRequest({ EDP_BILL_NO: "1" }), "invalid");
  const { EDP_CHECKSUM: _c, ...noChecksum } = result;
  assert.equal(classifyIdramRequest(noChecksum), "invalid");
});

test("order checks: account, existence, amount, payable", () => {
  const ok = { amountAmd: 500, payable: true };
  assert.equal(idramOrderProblem({ fields: result, expectedAccount: "123456", order: ok }), null);
  assert.equal(idramOrderProblem({ fields: { ...result, EDP_AMOUNT: "500" }, expectedAccount: "123456", order: ok }), null);
  assert.equal(idramOrderProblem({ fields: result, expectedAccount: "999", order: ok }), "WRONG_ACCOUNT");
  assert.equal(idramOrderProblem({ fields: result, expectedAccount: "123456", order: null }), "ORDER_NOT_FOUND");
  assert.equal(
    idramOrderProblem({ fields: result, expectedAccount: "123456", order: { amountAmd: 1900, payable: true } }),
    "AMOUNT_MISMATCH",
  );
  assert.equal(
    idramOrderProblem({ fields: { ...result, EDP_AMOUNT: "500.50" }, expectedAccount: "123456", order: ok }),
    "AMOUNT_MISMATCH",
  );
  assert.equal(
    idramOrderProblem({ fields: result, expectedAccount: "123456", order: { amountAmd: 500, payable: false } }),
    "ORDER_NOT_PAYABLE",
  );
});

test("builds the EDP form", () => {
  const form = buildIdramForm(
    { accountId: "123456", actionUrl: "https://banking.idram.am/Payment/GetPayment" },
    { billNo: 100001, amountAmd: 500, description: "Order 100001", lang: "hy", email: "a@b.am" },
  );
  assert.deepEqual(form, {
    mode: "form",
    action: "https://banking.idram.am/Payment/GetPayment",
    method: "POST",
    fields: {
      EDP_LANGUAGE: "AM",
      EDP_REC_ACCOUNT: "123456",
      EDP_DESCRIPTION: "Order 100001",
      EDP_AMOUNT: "500",
      EDP_BILL_NO: "100001",
      EDP_EMAIL: "a@b.am",
    },
  });
  assert.equal(idramLanguage("en"), "EN");
  assert.equal(idramLanguage("ru"), "RU");
});

test("parses form bodies", () => {
  assert.deepEqual(parseFormBody("EDP_PRECHECK=YES&EDP_AMOUNT=500.00&EDP_DESCRIPTION=Order+1"), {
    EDP_PRECHECK: "YES",
    EDP_AMOUNT: "500.00",
    EDP_DESCRIPTION: "Order 1",
  });
});
