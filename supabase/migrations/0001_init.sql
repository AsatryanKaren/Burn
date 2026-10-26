-- =============================================================================
-- 0001_init.sql — initial schema for the New Year burn ritual site.
--
-- Contract: docs/ARCHITECTURE.md. Notes: docs/BACKEND.md.
--
-- Security model
--   * Every table has RLS enabled and NO policies for anon/authenticated, and
--     those roles have no table/sequence privileges at all.
--   * The browser reads data only through two SECURITY DEFINER RPCs
--     (get_public_stats, get_fire_feed) that return public-safe fields.
--   * Edge Functions use the service_role key. An order becomes `paid` only
--     inside confirm_payment(), which edge functions call after verifying the
--     payment with the provider.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Default privileges: objects that the migration role (postgres) creates in
-- `public` from now on get no automatic grants for anon/authenticated/PUBLIC.
-- Any future browser-facing RPC must be granted explicitly.
-- -----------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Sequences
-- -----------------------------------------------------------------------------
-- Public, sequential paper number, assigned only when a payment is confirmed.
create sequence public.burn_number_seq as integer start with 1 increment by 1 no cycle;

-- Numeric order id for banks that require one (Ameriabank OrderID, Idram
-- EDP_BILL_NO). Starts high so ids look the same width; if the bank sandbox
-- requires a specific OrderID range, `alter sequence ... restart with N`.
create sequence public.provider_order_num_seq as bigint start with 100001 increment by 1 no cycle;

-- -----------------------------------------------------------------------------
-- products — source of truth for prices
-- -----------------------------------------------------------------------------
create table public.products (
  code      text    primary key,
  price_amd integer not null,
  active    boolean not null default true,
  sort      integer not null default 0,
  constraint products_code_format check (code ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint products_price_positive check (price_amd > 0 and price_amd <= 10000000)
);

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
create table public.orders (
  id                  bigint generated always as identity primary key,
  code                text        not null unique,
  product             text        not null references public.products(code) on update cascade on delete restrict,
  amount_amd          integer     not null,
  status              text        not null default 'pending',
  lang                text        not null default 'hy',
  email               text,
  text                text        not null,
  wish_text           text,
  recipient_name      text,
  show_on_stream      boolean     not null default false,
  moderation          text        not null default 'pending',
  moderation_reason   text,
  burn_number         integer     unique,
  provider            text,
  provider_payment_id text        unique,
  provider_order_num  bigint      not null unique default nextval('public.provider_order_num_seq'),
  ip_hash             text,
  created_at          timestamptz not null default now(),
  paid_at             timestamptz,
  streamed_at         timestamptz,
  updated_at          timestamptz not null default now(),

  -- 16 chars of Crockford base32, lowercase (no i, l, o, u).
  constraint orders_code_format      check (code ~ '^[0-9a-hjkmnp-tv-z]{16}$'),
  constraint orders_amount_positive  check (amount_amd > 0),
  constraint orders_status_enum      check (status in ('awaiting_launch', 'pending', 'paid', 'failed', 'cancelled', 'refunded')),
  constraint orders_moderation_enum  check (moderation in ('pending', 'approved', 'hidden', 'rejected')),
  constraint orders_lang_enum        check (lang in ('hy', 'en', 'ru')),
  constraint orders_provider_enum    check (provider is null or provider in ('mock', 'ameria', 'idram')),
  constraint orders_text_len         check (char_length(text) between 1 and 120),
  constraint orders_wish_len         check (wish_text is null or char_length(wish_text) between 1 and 200),
  constraint orders_recipient_len    check (recipient_name is null or char_length(recipient_name) between 1 and 40),
  constraint orders_moderation_reason_len check (moderation_reason is null or char_length(moderation_reason) <= 200),
  constraint orders_email_format     check (
    email is null or (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
  ),
  constraint orders_ip_hash_format   check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  -- A wish belongs to burn_wish / midnight only; a recipient to gift only.
  constraint orders_wish_matches_product      check ((wish_text is not null) = (product in ('burn_wish', 'midnight'))),
  constraint orders_recipient_matches_product check ((recipient_name is not null) = (product = 'gift')),
  -- We must be able to send the payment link at launch.
  constraint orders_awaiting_needs_email check (status <> 'awaiting_launch' or email is not null),
  -- Paid orders always carry their payment facts.
  constraint orders_paid_complete check (
    status <> 'paid' or (burn_number is not null and paid_at is not null and provider is not null and provider_payment_id is not null)
  )
);

create index orders_product_idx         on public.orders (product);
create index orders_status_created_idx  on public.orders (status, created_at desc);
create index orders_moderation_queue_idx on public.orders (created_at) where moderation = 'pending' and status = 'paid';
create index orders_email_idx           on public.orders (lower(email)) where email is not null;

-- -----------------------------------------------------------------------------
-- gift_ledger — 20% of each paid amount, floor, one row per paid order
-- -----------------------------------------------------------------------------
create table public.gift_ledger (
  id         bigint generated always as identity primary key,
  order_id   bigint      not null unique references public.orders(id) on delete restrict,
  amount_amd integer     not null,
  created_at timestamptz not null default now(),
  constraint gift_ledger_amount_nonneg check (amount_amd >= 0)
);

-- -----------------------------------------------------------------------------
-- waitlist — emails are stored lower-cased (enforced), unique
-- -----------------------------------------------------------------------------
create table public.waitlist (
  id         bigint generated always as identity primary key,
  email      text        not null unique,
  lang       text        not null default 'hy',
  created_at timestamptz not null default now(),
  ip_hash    text,
  constraint waitlist_email_lower  check (email = lower(email)),
  constraint waitlist_email_format check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint waitlist_lang_enum    check (lang in ('hy', 'en', 'ru')),
  constraint waitlist_ip_hash_format check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')
);

-- -----------------------------------------------------------------------------
-- rate_limits — fixed-window counters keyed by e.g. 'order:<ip_hash>'
-- -----------------------------------------------------------------------------
create table public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  count        integer     not null default 0,
  primary key (key, window_start),
  constraint rate_limits_key_len check (char_length(key) between 1 and 200)
);

create index rate_limits_window_idx on public.rate_limits (window_start);

-- -----------------------------------------------------------------------------
-- payment_events — raw audit of every provider callback / return
-- -----------------------------------------------------------------------------
create table public.payment_events (
  id         bigint generated always as identity primary key,
  provider   text        not null,
  kind       text        not null,
  order_code text,
  payload    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint payment_events_provider_len check (char_length(provider) between 1 and 32),
  constraint payment_events_kind_len     check (char_length(kind) between 1 and 64)
);

create index payment_events_order_code_idx on public.payment_events (order_code) where order_code is not null;
create index payment_events_created_idx    on public.payment_events (created_at desc);

-- -----------------------------------------------------------------------------
-- updated_at trigger
-- -----------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- RLS: enabled everywhere, no policies for anon/authenticated.
-- -----------------------------------------------------------------------------
alter table public.products       enable row level security;
alter table public.orders         enable row level security;
alter table public.gift_ledger    enable row level security;
alter table public.waitlist       enable row level security;
alter table public.rate_limits    enable row level security;
alter table public.payment_events enable row level security;

revoke all on table public.products, public.orders, public.gift_ledger, public.waitlist,
                    public.rate_limits, public.payment_events
  from public, anon, authenticated;
revoke all on sequence public.burn_number_seq, public.provider_order_num_seq
  from public, anon, authenticated;

grant select, insert, update, delete on table public.products, public.orders, public.gift_ledger,
                                               public.waitlist, public.rate_limits, public.payment_events
  to service_role;
grant usage, select on sequence public.burn_number_seq, public.provider_order_num_seq to service_role;

revoke all on function public.set_updated_at() from public, anon, authenticated;

-- =============================================================================
-- Public RPCs (anon + authenticated)
-- =============================================================================

-- { papers_burned, gift_fund_amd, wishes_kept, waitlist_count, updated_at }
create function public.get_public_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'papers_burned',  (select count(*) from public.orders where status = 'paid'),
    'gift_fund_amd',  (select coalesce(sum(amount_amd), 0) from public.gift_ledger),
    'wishes_kept',    (select count(*) from public.orders where status = 'paid' and wish_text is not null),
    'waitlist_count', (select count(*) from public.waitlist),
    'updated_at',     now()
  );
$$;

-- Paid papers in burn order. text_public is null unless the buyer allowed it
-- AND moderation approved it. max_rows is clamped to 1..100.
create function public.get_fire_feed(after_number integer default 0, max_rows integer default 50)
returns table (burn_number integer, text_public text, paid_at timestamptz, product text)
language sql
stable
security definer
set search_path = public
as $$
  select o.burn_number,
         case when o.show_on_stream and o.moderation = 'approved' then o.text end as text_public,
         o.paid_at,
         o.product
    from public.orders o
   where o.status = 'paid'
     and o.burn_number > coalesce(after_number, 0)
   order by o.burn_number
   limit least(greatest(coalesce(max_rows, 50), 1), 100);
$$;

revoke all on function public.get_public_stats() from public;
revoke all on function public.get_fire_feed(integer, integer) from public;
grant execute on function public.get_public_stats() to anon, authenticated, service_role;
grant execute on function public.get_fire_feed(integer, integer) to anon, authenticated, service_role;

-- =============================================================================
-- Internal functions (service_role only)
-- =============================================================================

-- Marks an order paid. Call ONLY after the payment was verified with the
-- provider server-to-server (or by the provider's signature).
--
-- Returns json:
--   { ok: true,  burn_number, already: false }               newly paid
--   { ok: true,  burn_number, already: true }                same payment seen before
--   { ok: false, burn_number: null, already: false, error }  refused; error is one of
--       INVALID_ARGS, ORDER_NOT_FOUND, PROVIDER_MISMATCH, PAYMENT_ID_USED,
--       ORDER_NOT_PAYABLE, AMOUNT_MISMATCH
--   { ok: false, burn_number, already: true, error: 'ORDER_PAID_BY_OTHER_PAYMENT' }
--       the order is already paid by a different payment (possible double charge,
--       needs a manual refund).
create function public.confirm_payment(p_code text, p_provider text, p_payment_id text, p_amount integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders%rowtype;
  v_number integer;
  v_gift   integer;
begin
  if p_code is null or p_provider is null or p_payment_id is null or p_amount is null
     or p_provider not in ('mock', 'ameria', 'idram')
     or char_length(p_payment_id) not between 1 and 200 then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'INVALID_ARGS');
  end if;

  -- Serialize all confirmations of this order.
  select * into v_order from public.orders where code = p_code for update;
  if not found then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- Idempotency per order: already paid.
  if v_order.status = 'paid' then
    if v_order.provider = p_provider and v_order.provider_payment_id = p_payment_id then
      return json_build_object('ok', true, 'burn_number', v_order.burn_number, 'already', true);
    end if;
    return json_build_object('ok', false, 'burn_number', v_order.burn_number, 'already', true,
                             'error', 'ORDER_PAID_BY_OTHER_PAYMENT');
  end if;

  if v_order.provider is not null and v_order.provider <> p_provider then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'PROVIDER_MISMATCH');
  end if;

  -- Idempotency per provider payment id: never count one payment for two orders.
  if exists (select 1 from public.orders where provider_payment_id = p_payment_id and id <> v_order.id) then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'PAYMENT_ID_USED');
  end if;

  if v_order.status not in ('pending', 'awaiting_launch', 'failed') then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'ORDER_NOT_PAYABLE');
  end if;

  if p_amount <> v_order.amount_amd then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'AMOUNT_MISMATCH');
  end if;

  v_number := nextval('public.burn_number_seq');
  v_gift   := (v_order.amount_amd * 20) / 100;  -- integer division = floor for positive amounts

  update public.orders
     set status              = 'paid',
         burn_number         = v_number,
         provider            = p_provider,
         provider_payment_id = p_payment_id,
         paid_at             = now()
   where id = v_order.id;

  insert into public.gift_ledger (order_id, amount_amd) values (v_order.id, v_gift);

  return json_build_object('ok', true, 'burn_number', v_number, 'already', false);
end;
$$;

-- Fixed-window rate limiter. Returns true when the call is allowed (the
-- counter for the current window is still <= p_limit after incrementing).
create function public.check_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count  integer;
begin
  if p_key is null or p_limit is null or p_window_seconds is null or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'check_rate_limit: invalid arguments' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  -- Opportunistic cleanup of old windows (~1% of calls).
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end;
$$;

revoke all on function public.confirm_payment(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.check_rate_limit(text, integer, integer)  from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, text, integer) to service_role;
grant execute on function public.check_rate_limit(text, integer, integer)  to service_role;

-- =============================================================================
-- Seed
-- =============================================================================
insert into public.products (code, price_amd, active, sort) values
  ('burn',      500,  true, 10),
  ('burn_wish', 1900, true, 20),
  ('gift',      900,  true, 30),
  ('midnight',  2900, true, 40)
on conflict (code) do update set price_amd = excluded.price_amd, active = excluded.active, sort = excluded.sort;
