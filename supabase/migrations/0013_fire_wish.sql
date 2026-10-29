-- =============================================================================
-- 0013_fire_wish.sql — one payment, one light, one wish in the fire.
--
-- Contract: docs/ARCHITECTURE.md "Wish in the fire (migration 0013)".
-- Requires 0005_lights (light products, cell_holds). Apply after 0012_map_packed.
-- Apply once.
--
-- Product change: a person pays ONCE (500 AMD, product `light`: a plot on the
-- map with its room). That payment also includes exactly ONE wish burned in
-- the fire. There is no separate payment for burning and no second wish for
-- the same light. The paid paper product `burn` is retired for new orders
-- (create-order answers 400 PRODUCT_RETIRED); existing paper orders keep
-- working (start-payment, confirm_payment, the feed), so `products.active`
-- is not changed here.
--
--   * fire_wishes(order_id pk -> orders, text 1..120, show_on_stream, lang,
--     moderation, moderation_reason, burn_number unique from burn_number_seq,
--     created_at): one wish per light order. The burn number comes from the
--     papers' sequence, so the fire has one counter.
--   * burn_wish(p_code, p_text, p_show, p_lang, p_moderation, p_reason):
--     service_role only (the burn-wish edge function). The order must be a
--     light in status paid or awaiting_launch (saved before payments opened).
--     Idempotent per order: a second call returns the first wish's number
--     with already: true and changes nothing.
--   * A wish saved on an unpaid (awaiting_launch) order is not public. When
--     that order becomes paid, the trigger orders_fire_wish_on_paid gives the
--     wish a NEW burn number from the sequence, so it enters the fire after
--     everything already burned (the live page polls get_fire_feed with
--     after_number and would otherwise never see an old, lower number).
--   * get_fire_feed: paper orders as in 0005 plus wishes of paid orders
--     (product = 'wish'); text_public only when show_on_stream and approved.
--   * get_public_stats: papers_burned = paid papers + wishes of paid orders.
--     All other keys as in 0005 (the latest definition).
--   * admin_list_orders (0005) gains fire_text, fire_moderation,
--     fire_burn_number, fire_show_on_stream; q also searches the wish text.
--   * admin_moderate_wish(p_code, p_moderation, p_reason): service_role only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fire_wishes — at most one wish per order
-- -----------------------------------------------------------------------------
create table public.fire_wishes (
  order_id          bigint      primary key references public.orders(id) on delete cascade,
  text              text        not null,
  show_on_stream    boolean     not null default true,
  lang              text        not null default 'hy',
  moderation        text        not null default 'pending',
  moderation_reason text,
  burn_number       integer     not null unique default nextval('public.burn_number_seq'),
  created_at        timestamptz not null default now(),
  -- Same rules as a paper's text (orders_text_len for papers, orders_*_enum).
  constraint fire_wishes_text_len        check (char_length(text) between 1 and 120),
  constraint fire_wishes_lang_enum       check (lang in ('hy', 'en', 'ru')),
  constraint fire_wishes_moderation_enum check (moderation in ('pending', 'approved', 'hidden', 'rejected')),
  constraint fire_wishes_moderation_reason_len check (moderation_reason is null or char_length(moderation_reason) <= 200)
);

-- moderation queue
create index fire_wishes_moderation_queue_idx on public.fire_wishes (created_at) where moderation = 'pending';

alter table public.fire_wishes enable row level security;
revoke all on table public.fire_wishes from public, anon, authenticated;
grant select, insert, update, delete on table public.fire_wishes to service_role;

-- -----------------------------------------------------------------------------
-- burn_wish — save the one wish of a light order.
--
--   { ok: true,  already: false, burn_number }   saved now
--   { ok: true,  already: true,  burn_number }   this order already has a wish
--                                                 (nothing changes, the text
--                                                 sent now is ignored)
--   { ok: false, error }   ORDER_NOT_FOUND | ORDER_NOT_LIGHT | ORDER_NOT_PAID
--                          | INVALID_ARGS (null/out-of-range arguments; the
--                          edge function validates before calling)
-- The order row is locked (for update), so two concurrent calls for one order
-- serialize: exactly one inserts, the other answers already: true.
-- A wish of an awaiting_launch order gets a provisional number; it is
-- renumbered when the order is paid (trigger below).
-- -----------------------------------------------------------------------------
create function public.burn_wish(
  p_code       text,
  p_text       text,
  p_show       boolean,
  p_lang       text,
  p_moderation text,
  p_reason     text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  public.orders%rowtype;
  v_number integer;
begin
  if p_code is null or p_text is null or char_length(p_text) not between 1 and 120
     or p_moderation is null or p_moderation not in ('pending', 'approved', 'hidden', 'rejected') then
    return json_build_object('ok', false, 'error', 'INVALID_ARGS');
  end if;

  select * into v_order from public.orders where code = p_code for update;
  if not found then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if v_order.product not in ('light', 'light_big') then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_LIGHT');
  end if;
  if v_order.status not in ('paid', 'awaiting_launch') then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_PAID');
  end if;

  select w.burn_number into v_number from public.fire_wishes w where w.order_id = v_order.id;
  if found then
    return json_build_object('ok', true, 'already', true, 'burn_number', v_number);
  end if;

  insert into public.fire_wishes (order_id, text, show_on_stream, lang, moderation, moderation_reason)
  values (v_order.id, p_text, coalesce(p_show, true),
          case when p_lang in ('hy', 'en', 'ru') then p_lang else v_order.lang end,
          p_moderation, left(nullif(btrim(coalesce(p_reason, '')), ''), 200))
  returning burn_number into v_number;

  return json_build_object('ok', true, 'already', false, 'burn_number', v_number);
end;
$$;

revoke all on function public.burn_wish(text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.burn_wish(text, text, boolean, text, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- A wish saved before payment enters the fire when the order is paid, with a
-- fresh number (after everything already burned).
-- -----------------------------------------------------------------------------
create function public.fire_wish_renumber_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.fire_wishes
     set burn_number = nextval('public.burn_number_seq')
   where order_id = new.id;
  return null;
end;
$$;

revoke all on function public.fire_wish_renumber_on_paid() from public, anon, authenticated;

create trigger orders_fire_wish_on_paid
  after update of status on public.orders
  for each row
  when (new.status = 'paid' and old.status is distinct from 'paid' and new.product in ('light', 'light_big'))
  execute function public.fire_wish_renumber_on_paid();

-- -----------------------------------------------------------------------------
-- get_fire_feed — paid papers (as 0005) + wishes of paid light orders, in one
-- burn order. Same signature, columns and clamps.
--   product   : the paper's product, or 'wish' for a light's wish
--   paid_at   : papers: paid_at; wishes: when the wish entered the fire
--               (the later of the order's payment and the wish)
--   text_public: null unless show_on_stream and moderation = 'approved'
-- -----------------------------------------------------------------------------
create or replace function public.get_fire_feed(after_number integer default 0, max_rows integer default 50)
returns table (burn_number integer, text_public text, paid_at timestamptz, product text)
language sql
stable
security definer
set search_path = public
as $$
  select f.burn_number, f.text_public, f.paid_at, f.product
    from (
      select o.burn_number,
             case when o.show_on_stream and o.moderation = 'approved' then o.text end as text_public,
             o.paid_at,
             o.product
        from public.orders o
       where o.status = 'paid'
         and o.product not in ('light', 'light_big')
         and o.burn_number > coalesce(after_number, 0)
      union all
      select w.burn_number,
             case when w.show_on_stream and w.moderation = 'approved' then w.text end as text_public,
             greatest(o.paid_at, w.created_at) as paid_at,
             'wish'::text as product
        from public.fire_wishes w
        join public.orders o on o.id = w.order_id
       where o.status = 'paid'
         and w.burn_number > coalesce(after_number, 0)
    ) f
   order by f.burn_number
   limit least(greatest(coalesce(max_rows, 50), 1), 100);
$$;

-- -----------------------------------------------------------------------------
-- get_public_stats — as 0005; papers_burned also counts wishes of paid orders.
-- { papers_burned, gift_fund_amd, wishes_kept, waitlist_count, lights_lit, updated_at }
-- -----------------------------------------------------------------------------
create or replace function public.get_public_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'papers_burned',  (select count(*) from public.orders
                        where status = 'paid' and product not in ('light', 'light_big'))
                      + (select count(*) from public.fire_wishes w join public.orders o on o.id = w.order_id
                          where o.status = 'paid'),
    'gift_fund_amd',  (select coalesce(sum(amount_amd), 0) from public.gift_ledger),
    'wishes_kept',    (select count(*) from public.orders where status = 'paid' and wish_text is not null),
    'waitlist_count', (select count(*) from public.waitlist),
    'lights_lit',     (select count(*) from public.cell_holds h join public.orders o on o.id = h.order_id
                        where h.expires_at = 'infinity' and o.status = 'paid'),
    'updated_at',     now()
  );
$$;

-- create or replace keeps the existing grants; restated unchanged.
revoke all on function public.get_public_stats() from public;
revoke all on function public.get_fire_feed(integer, integer) from public;
grant execute on function public.get_public_stats() to anon, authenticated, service_role;
grant execute on function public.get_fire_feed(integer, integer) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- admin_list_orders — as 0005, plus the order's wish in the fire
-- (fire_text, fire_moderation, fire_burn_number, fire_show_on_stream; null
-- when there is none); q also searches the wish text.
-- -----------------------------------------------------------------------------
create or replace function public.admin_list_orders(
  p_status     text    default null,
  p_moderation text    default null,
  p_q          text    default null,
  p_limit      integer default 50,
  p_before_id  bigint  default null
)
returns json
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select nullif(btrim(p_q), '') as term
  ), rows as (
    select o.id, o.code, o.product, o.amount_amd, o.status, o.moderation, o.moderation_reason,
           o.burn_number, o.text, o.wish_text, o.recipient_name, o.email, o.lang, o.show_on_stream,
           o.created_at, o.paid_at,
           o.cell_id, o.light_icon, o.light_color, o.light_signature,
           w.text as fire_text, w.moderation as fire_moderation, w.burn_number as fire_burn_number,
           w.show_on_stream as fire_show_on_stream
      from public.orders o
      left join public.fire_wishes w on w.order_id = o.id
      cross join q
     where (p_status is null or o.status = p_status)
       and (p_moderation is null or o.moderation = p_moderation)
       and (p_before_id is null or o.id < p_before_id)
       and (q.term is null
            or o.code like lower(q.term) || '%'
            or strpos(lower(coalesce(o.email, '')), lower(q.term)) > 0
            or strpos(lower(o.text), lower(q.term)) > 0
            or strpos(lower(coalesce(o.wish_text, '')), lower(q.term)) > 0
            or strpos(lower(coalesce(o.recipient_name, '')), lower(q.term)) > 0
            or strpos(lower(coalesce(o.light_signature, '')), lower(q.term)) > 0
            or strpos(lower(coalesce(w.text, '')), lower(q.term)) > 0)
     order by o.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select coalesce(json_agg(rows order by rows.id desc), '[]'::json) from rows;
$$;

revoke all on function public.admin_list_orders(text, text, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.admin_list_orders(text, text, text, integer, bigint) to service_role;

-- -----------------------------------------------------------------------------
-- admin_moderate_wish — like admin_moderate (0003), for the order's wish.
--   { ok: true, code, moderation } | { ok: false, error: INVALID_MODERATION |
--   ORDER_NOT_FOUND | WISH_NOT_FOUND }
-- -----------------------------------------------------------------------------
create function public.admin_moderate_wish(p_code text, p_moderation text, p_reason text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id bigint;
  v_updated  bigint;
begin
  if p_moderation is null or p_moderation not in ('approved', 'hidden', 'rejected') then
    return json_build_object('ok', false, 'error', 'INVALID_MODERATION');
  end if;
  select id into v_order_id from public.orders where code = p_code;
  if v_order_id is null then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  update public.fire_wishes
     set moderation = p_moderation,
         moderation_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 200)
   where order_id = v_order_id
  returning order_id into v_updated;
  if v_updated is null then
    return json_build_object('ok', false, 'error', 'WISH_NOT_FOUND');
  end if;
  return json_build_object('ok', true, 'code', p_code, 'moderation', p_moderation);
end;
$$;

revoke all on function public.admin_moderate_wish(text, text, text) from public, anon, authenticated;
grant execute on function public.admin_moderate_wish(text, text, text) to service_role;
