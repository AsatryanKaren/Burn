# Backend

Supabase project `maqcaowpfhmqcavboszy` (eu-central-1). The contract is `docs/ARCHITECTURE.md`; this file is the operator's manual.

```
supabase/
  config.toml                 CLI config: verify_jwt = false for every function
  migrations/
    0001_init.sql             schema, RLS, public RPCs, confirm_payment, check_rate_limit, seed products
    0002_payment_attempts.sql begin_payment_attempt (used by start-payment)
    0003_admin.sql            admin RPCs (stats, list, moderate, refund, exports, peek_rate_limit)
  functions/
    _shared/                  shared code (see "Code layout")
    create-order/  order-status/  start-payment/  join-waitlist/
    pay-return-ameria/  pay-callback-idram/  pay-mock/  admin/
  tests/                      unit tests for the pure modules (node:test)
```

## Current state (2026-10-27)

| Item | State |
|---|---|
| `0001_init`, `0002_payment_attempts` | applied |
| `0003_admin` | **not applied** — the apply was cancelled at the confirmation prompt (it contains a `delete` inside `admin_mark_refunded`). Apply it (below) or the `admin` function answers 500. |
| `pg_net` extension | enabled (schema `extensions`) to smoke-test the deployed functions from SQL. Harmless; drop it if you don't want it: `drop extension pg_net;` |
| Edge functions | all 8 deployed, `verify_jwt = false` |
| Function secrets | **none set yet** — the code runs on safe defaults (see "Secrets") |
| Test rows | 4 test orders + 3 payment_events + rate-limit rows are still in the DB (cleanup needs a `delete`, which needs your confirmation). SQL under "Cleanup". |

## Migrations

With the Supabase CLI (from the repo root):

```sh
supabase link --project-ref maqcaowpfhmqcavboszy
supabase db push            # applies supabase/migrations/* not yet applied
```

Or paste a migration file into the dashboard SQL editor. Migrations are plain SQL and are written to be applied once, in order.

Security model, enforced by 0001:
- RLS is enabled on every table with **no** policies, and `anon`/`authenticated` have no table or sequence privileges at all.
- Default privileges for objects created by `postgres` in `public` no longer grant anything to `anon`/`authenticated`/`PUBLIC`: any future browser RPC needs an explicit `grant execute`.
- Browser-callable: `get_public_stats()`, `get_fire_feed(after_number, max_rows)` (SECURITY DEFINER, `search_path = public`).
- `service_role` only: `confirm_payment`, `check_rate_limit`, `begin_payment_attempt`, `peek_rate_limit`, `admin_*`.
- An order becomes `paid` only in `confirm_payment`, which locks the order row, checks provider, amount and payment id, is idempotent (same payment → `already: true`; a second, different payment for a paid order → `ORDER_PAID_BY_OTHER_PAYMENT`, needs a manual refund; one payment id can never pay two orders), assigns `burn_number` from `burn_number_seq`, writes the floor(20%) `gift_ledger` row and sets `paid_at`.

Security advisor: the remaining notices are intentional — `rls_enabled_no_policy` (INFO, by design) and `anon/authenticated_security_definer_function_executable` (WARN) for exactly the two public RPCs the contract requires.

## Deploy functions

```sh
supabase functions deploy --project-ref maqcaowpfhmqcavboszy          # all, uses config.toml (verify_jwt=false)
supabase functions deploy create-order --no-verify-jwt --project-ref maqcaowpfhmqcavboszy   # one
```

Functions import shared code as `../_shared/*.ts` and `npm:@supabase/supabase-js@2`; no import map is needed.

Base URL: `https://maqcaowpfhmqcavboszy.supabase.co/functions/v1/<name>`.

## Secrets

Set in Dashboard → Edge Functions → Secrets, or:

```sh
supabase secrets set --project-ref maqcaowpfhmqcavboszy \
  PAYMENT_PROVIDER=disabled SITE_URL=https://example.invalid ALLOWED_ORIGINS= ALLOW_LOCALHOST=1 \
  IP_HASH_SALT=<64 hex chars> ADMIN_TOKEN=<random, >= 32 chars> AUTO_APPROVE=1
```

| Secret | Default when unset | Notes |
|---|---|---|
| `PAYMENT_PROVIDER` | `disabled` | `disabled` \| `mock` \| `ameria` \| `idram`; unknown values → `disabled` |
| `SITE_URL` | `https://example.invalid` | used for redirects and CSV links; its origin is always CORS-allowed (unless `.invalid`) |
| `ALLOWED_ORIGINS` | empty | comma-separated; `https://*.vercel.app`-style wildcards allowed. **Empty = `https://*.vercel.app` + localhost** (never `*`) |
| `ALLOW_LOCALHOST` | off (but implied while `ALLOWED_ORIGINS` is empty) | `1` allows `http://localhost:*`, `127.0.0.1`, `[::1]` |
| `IP_HASH_SALT` | derived from the service-role key | set a real one; changing it only resets rate-limit counters |
| `AUTO_APPROVE` | `1` | `1`: clean texts are `approved` at creation; `0`: `pending` until approved in admin |
| `ADMIN_TOKEN` | unset → admin always 401 | must be ≥ 32 chars; rotate by setting a new value |
| `AMERIA_CLIENT_ID`, `AMERIA_USERNAME`, `AMERIA_PASSWORD`, `AMERIA_API_BASE` | — | all four required for `ameria`; test base `https://servicestest.ameriabank.am/VPOS` |
| `IDRAM_ACCOUNT_ID`, `IDRAM_SECRET_KEY` | — | required for `idram` |
| `IDRAM_ACTION_URL` | `https://banking.idram.am/Payment/GetPayment` | override only if Idram says so |

If `PAYMENT_PROVIDER` names a provider whose secrets are missing, `create-order` / `start-payment` answer `503 PAYMENT_MISCONFIGURED` (fail closed, nothing is saved).

## Switching the payment provider

1. Set the provider's secrets, then `PAYMENT_PROVIDER=ameria` (or `idram`). Secrets apply to new function instances within seconds; no redeploy needed.
2. Saved papers (`awaiting_launch`) are paid through `POST start-payment { code, lang }` — export them with admin `awaiting_launch_csv` and email each buyer their link.
3. To test end-to-end without a bank: `PAYMENT_PROVIDER=mock`. `create-order` returns `payment.mode = "mock"` with a `pay-mock?code=…` URL that marks the order paid and redirects. **Never leave `mock` on in production** — anyone could mark their own order paid.

### `payment` shapes (create-order and start-payment)

```json
{ "mode": "disabled" }
{ "mode": "mock",     "url": "https://…/functions/v1/pay-mock?code=…" }
{ "mode": "redirect", "url": "https://servicestest.ameriabank.am/VPOS/Payments/Pay?id=…&lang=am" }
{ "mode": "form", "action": "https://banking.idram.am/Payment/GetPayment", "method": "POST",
  "fields": { "EDP_LANGUAGE": "AM", "EDP_REC_ACCOUNT": "…", "EDP_DESCRIPTION": "Order 100001",
              "EDP_AMOUNT": "500", "EDP_BILL_NO": "100001", "EDP_EMAIL": "…" } }
```

`form` (Idram): build `<form method="POST" action="{action}">` with one hidden `<input name value>` per field and submit it. Idram returns the buyer to static SUCCESS/FAIL URLs set in its merchant cabinet, which do not carry our code: the frontend should remember the order code (e.g. `localStorage`) before submitting and show `/p/{code}` afterwards.

Redirects after payment go to `${SITE_URL}/p/{code}` (hy) or `${SITE_URL}/{en|ru}/p/{code}`; `vercel.json` needs a rewrite from `/p/:code` (and `/en/p/:code`, `/ru/p/:code`) to the static `/p/?c=:code` page.

## Error codes by function

All JSON errors are `{ "error": { "code", "message" } }`. Browser endpoints also return `403 ORIGIN_NOT_ALLOWED` (browser Origin not allowed), `405 METHOD_NOT_ALLOWED`, `413 PAYLOAD_TOO_LARGE` (body > 8 KB), `500 INTERNAL`.

| Function | Codes |
|---|---|
| `create-order` | 400 `INVALID_JSON`, `CONSENT_REQUIRED`, `INVALID_PRODUCT`, `TEXT_REQUIRED`, `TEXT_TOO_LONG`, `WISH_REQUIRED`, `WISH_TOO_LONG`, `WISH_NOT_ALLOWED`, `RECIPIENT_REQUIRED`, `RECIPIENT_TOO_LONG`, `RECIPIENT_NOT_ALLOWED`, `EMAIL_REQUIRED` (only while payments are disabled), `EMAIL_INVALID`, `TEXT_REJECTED`, `PRODUCT_UNAVAILABLE`; 429 `RATE_LIMITED`; 502 `PAYMENT_UNAVAILABLE` (bank did not answer InitPayment; order marked failed); 503 `PAYMENT_MISCONFIGURED` |
| `order-status` | 404 `NOT_FOUND` (also for malformed codes); 429 `RATE_LIMITED` (120 / 10 min) |
| `start-payment` | 400 `INVALID_JSON`; 404 `NOT_FOUND`; 409 `ALREADY_PAID`, `ORDER_NOT_PAYABLE` (cancelled/refunded); 429 `RATE_LIMITED`; 502 `PAYMENT_UNAVAILABLE`; 503 `PAYMENT_MISCONFIGURED` |
| `join-waitlist` | 400 `INVALID_JSON`, `EMAIL_REQUIRED`, `EMAIL_INVALID`; 429 `RATE_LIMITED`. Same `{ok:true}` for new and known emails |
| `admin` | 401 `UNAUTHORIZED`; 429 `RATE_LIMITED` (failed attempts); 400 `INVALID_JSON`, `INVALID_REQUEST`; 404 `NOT_FOUND`; 409 `ORDER_NOT_PAID` (refund of an unpaid order) |
| `pay-mock` | 404 `NOT_FOUND` (provider not `mock`, or unknown code), 405; success = 302 |
| `pay-return-ameria` | always 302 (order page, or `${SITE_URL}/` when the order can't be identified) |
| `pay-callback-idram` | text/plain `OK` (accepted) or `FAIL` (refused); `ERROR` with 500 on internal errors |

Rate limits (per salted IP hash, fixed 10-minute windows): create-order 8, start-payment 8, join-waitlist 5, order-status 120, admin failed logins 10.

## Moderation

`_shared/moderation.ts`, lists in `_shared/moderation-data.ts` (edit there; matching rules are documented at the top of the file).
- Blocklist (strong profanity/slurs in Armenian script, Armenian Latin/Cyrillic transliteration, Russian, Russian translit, English) in `text`, `wish_text` or `recipient_name` → `400 TEXT_REJECTED`, nothing saved.
- Phone numbers, URLs/domains, emails, `@handles`, or a common Armenian first name (three scripts, with case endings and `-յան/-yan/-ян`) in `text`/`wish_text` → saved with `moderation='hidden'`, `moderation_reason='auto:<kind>'`. Never shown publicly.
- Otherwise `approved` (`AUTO_APPROVE=1`) or `pending`.
- Public text appears in `get_fire_feed` only when `show_on_stream` **and** `moderation='approved'`.

## Privacy in `payment_events`

Every bank request is logged **before** processing; payloads pass through `_shared/sanitize.ts`: masked card numbers, cardholder/client names, expiry, CVV, card-binding ids, emails and phones are dropped; `EDP_PAYER_ACCOUNT` is stored only as `sha256:<salted hash>`. Amounts, codes, ids, statuses and timestamps are kept.

## Tests

```sh
node --experimental-strip-types --test supabase/tests/
```

Node 22, no packages. `supabase/tests/package.json` points the directory at `index.ts`, which imports every `*.test.ts`. Pure modules under test import nothing from npm/jsr and use no Deno globals: `validation`, `moderation(+data)`, `codes`, `money`, `md5`, `idram`, `ameria`, `cors`, `config`, `iphash`, `sanitize`, `strings`, `admin`.

## Code layout (`functions/_shared`)

| Module | Pure? | Purpose |
|---|---|---|
| `types.ts`, `errors.ts` | yes | domain types, error codes, `ApiError` |
| `validation.ts` | yes | text normalization, order/waitlist validation |
| `moderation.ts`, `moderation-data.ts` | yes | auto-moderation and its word lists |
| `codes.ts` | yes | 16-char Crockford base32 order codes |
| `money.ts` | yes | floor(20%) gift share, provider amount parsing |
| `md5.ts`, `idram.ts` | yes | Idram form, request classification, checksum |
| `ameria.ts` | yes | Ameria request building and response evaluation |
| `cors.ts`, `config.ts`, `http.ts` | yes | origin policy, env parsing + URLs, responses/handler wrapper |
| `iphash.ts`, `strings.ts`, `sanitize.ts`, `admin.ts` | yes | IP hashing, constant-time compare, log sanitizing, admin parsing/CSV |
| `env.ts`, `db.ts`, `ratelimit.ts`, `payments.ts` | no | Deno env, service-role DB access, rate limits, provider HTTP calls |

## Bank-side checklist

Ameriabank vPOS (full list also in `_shared/ameria.ts`):
- [ ] Get test ClientID/Username/Password; set `AMERIA_*` with `AMERIA_API_BASE=https://servicestest.ameriabank.am/VPOS`.
- [ ] Confirm endpoints `/api/VPOS/InitPayment`, `/api/VPOS/GetPaymentDetails`, pay page `/Payments/Pay?id=…&lang=am|en|ru`.
- [ ] InitPayment success = `ResponseCode: 1`; GetPaymentDetails paid = `ResponseCode "00"` + `OrderStatus 2` (single-stage terminal — ask for single-stage; two-stage needs ConfirmPayment, not implemented).
- [ ] OrderID rules (integer, unique per InitPayment, any required test range → `alter sequence public.provider_order_num_seq restart with N`).
- [ ] Test amounts limits in sandbox (temporarily lower a product price in `products` rather than faking amounts).
- [ ] BackURL = `https://maqcaowpfhmqcavboszy.supabase.co/functions/v1/pay-return-ameria` (registered with the bank if required); confirm query names `orderID`, `paymentID`, `resposneCode`, `opaque`.
- [ ] `Opaque` echoed in GetPaymentDetails; `Currency` value (`051` or `AMD`).
- [ ] Production base `https://services.ameriabank.am/VPOS` and production credentials.

Idram (also in `_shared/idram.ts`):
- [ ] Merchant `EDP_REC_ACCOUNT` and SECRET_KEY → `IDRAM_ACCOUNT_ID`, `IDRAM_SECRET_KEY`.
- [ ] RESULT_URL = `https://maqcaowpfhmqcavboszy.supabase.co/functions/v1/pay-callback-idram`.
- [ ] SUCCESS_URL / FAIL_URL → the site (e.g. `${SITE_URL}/p/`), and whether they can carry `EDP_BILL_NO`.
- [ ] Confirm form action URL, `EDP_LANGUAGE` values, `EDP_BILL_NO` format (we send numeric `provider_order_num`), callback amount format, and what Idram does on a non-`OK` result answer.

Both:
- [ ] Legal pages live (`/terms/`, `/refund/`, `/privacy/`, `/delivery/`, `/contact/`).
- [ ] Real domain → `SITE_URL`, `ALLOWED_ORIGINS=https://<domain>,https://www.<domain>`, `ALLOW_LOCALHOST=0`.
- [ ] One full sandbox payment per provider; check `orders`, `gift_ledger`, `payment_events`.

## Operations SQL

```sql
-- Moderation queue (or use the admin page)
select code, text, moderation, moderation_reason from orders where moderation = 'pending' order by created_at;
update orders set moderation = 'approved' where code = '…';

-- Mark a paper as shown on the stream
update orders set streamed_at = now() where burn_number = …;

-- Gift fund check
select sum(amount_amd) from gift_ledger;
```

## Cleanup of the setup test data

```sql
delete from payment_events;           -- only the 3 smoke-test rows exist
delete from rate_limits;
delete from orders where code in ('zzzztest00000001', 'zzzztest00000002', '4we8vfv1hep037vv', 'arp6j1nyv750eg9d');
select setval('public.burn_number_seq', 1, false);
```

(`provider_order_num_seq` may stay where it is; gaps are fine.)
