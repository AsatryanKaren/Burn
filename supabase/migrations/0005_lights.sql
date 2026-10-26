-- =============================================================================
-- 0005_lights.sql — "Light up Armenia": lights on map plots.
--
-- Contract: docs/ARCHITECTURE.md "Light up Armenia (the map)".
-- Requires 0003_admin, 0003a_map_cells and 0004_cells_seed.
--
--   * products `light` (1500) and `light_big` (4900)
--   * orders gain cell_id / light_icon / light_color / light_signature
--   * cell_holds: a plot is taken while a hold with expires_at > now() exists;
--     paid lights hold their plot with expires_at = 'infinity'
--   * hold_cell(): service_role only, used by create-order / start-payment
--   * confirm_payment(): lights get no burn_number; the hold becomes infinite
--   * admin_mark_refunded(): frees the plot
--   * public: get_map(), get_cell(); get_public_stats() gains lights_lit;
--     papers_burned / get_fire_feed count paper products only
--
-- Product lists are spelled out in constraints and functions, like 0001 does
-- for burn_wish/midnight. Papers: burn, burn_wish, gift, midnight.
-- Lights: light, light_big.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- products
-- -----------------------------------------------------------------------------
insert into public.products (code, price_amd, active, sort) values
  ('light',     1500, true, 50),
  ('light_big', 4900, true, 60)
on conflict (code) do update set price_amd = excluded.price_amd, active = excluded.active, sort = excluded.sort;

-- -----------------------------------------------------------------------------
-- orders: light columns and constraints
-- -----------------------------------------------------------------------------
alter table public.orders
  add column cell_id         integer references public.map_cells(id) on update restrict on delete restrict,
  add column light_icon      text,
  add column light_color     text,
  add column light_signature text;

alter table public.orders
  add constraint orders_light_icon_enum  check (light_icon is null or light_icon in ('tree', 'home', 'candle', 'star', 'gift', 'pomegranate')),
  add constraint orders_light_color_enum check (light_color is null or light_color in ('amber', 'red', 'green', 'white', 'blue', 'violet')),
  add constraint orders_light_signature_len check (light_signature is null or char_length(light_signature) between 1 and 30),
  -- Light products carry a plot, an icon and a colour; papers carry none of the light fields.
  add constraint orders_light_matches_product check (
    case when product in ('light', 'light_big')
         then cell_id is not null and light_icon is not null and light_color is not null
         else cell_id is null and light_icon is null and light_color is null and light_signature is null
    end
  ),
  -- Lights never get a burn number (they are not papers on the fire).
  add constraint orders_light_no_burn_number check (product not in ('light', 'light_big') or burn_number is null);

-- Message length: 1–60 for lights, 1–120 (unchanged) for papers.
alter table public.orders drop constraint orders_text_len;
alter table public.orders add constraint orders_text_len check (
  char_length(text) between 1 and (case when product in ('light', 'light_big') then 60 else 120 end)
);

-- Paid orders carry their payment facts; papers also their burn number.
alter table public.orders drop constraint orders_paid_complete;
alter table public.orders add constraint orders_paid_complete check (
  status <> 'paid' or (
    paid_at is not null and provider is not null and provider_payment_id is not null
    and (burn_number is not null or product in ('light', 'light_big'))
  )
);

create index orders_cell_idx on public.orders (cell_id) where cell_id is not null;

-- -----------------------------------------------------------------------------
-- cell_holds — at most one hold per plot and per order
-- -----------------------------------------------------------------------------
create table public.cell_holds (
  cell_id    integer     primary key references public.map_cells(id) on delete restrict,
  order_id   bigint      not null unique references public.orders(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.cell_holds enable row level security;
revoke all on table public.cell_holds from public, anon, authenticated;
grant select, insert, update, delete on table public.cell_holds to service_role;

-- -----------------------------------------------------------------------------
-- hold_cell — take (or re-take) a plot for a light order.
--
-- true  : the plot is now held by this order until now() + p_minutes
--         (it was free, its hold had expired, or this order already held it)
-- false : the plot is held by another order (unexpired or paid), or the order
--         is not a payable (awaiting_launch | pending | failed) light order
--         for this plot
-- Atomic under concurrency: the insert ... on conflict takes the row lock, so
-- of two orders racing for a free plot exactly one gets true.
-- -----------------------------------------------------------------------------
create function public.hold_cell(p_order_id bigint, p_cell_id integer, p_minutes integer default 30)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_cell  integer;
begin
  if p_order_id is null or p_cell_id is null or p_minutes is null or p_minutes not between 1 and 1440 then
    raise exception 'hold_cell: invalid arguments' using errcode = '22023';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found
     or v_order.product not in ('light', 'light_big')
     or v_order.cell_id is distinct from p_cell_id
     or v_order.status not in ('awaiting_launch', 'pending', 'failed') then
    return false;
  end if;

  -- A hold of this order on another plot (only possible if an admin moved the
  -- order) would block the unique(order_id); drop it unless it is a paid one.
  delete from public.cell_holds
   where order_id = p_order_id and cell_id <> p_cell_id and expires_at <> 'infinity';

  insert into public.cell_holds as h (cell_id, order_id, expires_at)
  values (p_cell_id, p_order_id, now() + make_interval(mins => p_minutes))
  on conflict (cell_id) do update
     set order_id = excluded.order_id, expires_at = excluded.expires_at, created_at = now()
   where h.expires_at < now()
      or (h.order_id = excluded.order_id and h.expires_at <> 'infinity')
  returning h.cell_id into v_cell;

  return v_cell is not null;
end;
$$;

revoke all on function public.hold_cell(bigint, integer, integer) from public, anon, authenticated;
grant execute on function public.hold_cell(bigint, integer, integer) to service_role;

-- -----------------------------------------------------------------------------
-- confirm_payment — as in 0001, plus lights:
--   * no burn_number for light products (burn_number: null in the result)
--   * the plot hold becomes 'infinity' for this order; if another order holds
--     the plot (this hold expired and someone else took it), the order is still
--     paid, moderation_reason = 'cell_conflict', result cell_conflict: true —
--     the admin moves or refunds it.
-- Return shape is unchanged for papers; lights add `cell_conflict`.
-- -----------------------------------------------------------------------------
create or replace function public.confirm_payment(p_code text, p_provider text, p_payment_id text, p_amount integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders%rowtype;
  v_number   integer;
  v_gift     integer;
  v_light    boolean;
  v_cell     integer;
  v_conflict boolean := false;
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

  v_light  := v_order.product in ('light', 'light_big');
  v_number := case when v_light then null else nextval('public.burn_number_seq') end;
  v_gift   := (v_order.amount_amd * 20) / 100;  -- integer division = floor for positive amounts

  if v_light then
    -- Make the plot this order's forever: free, expired, or already held by this order.
    insert into public.cell_holds as h (cell_id, order_id, expires_at)
    values (v_order.cell_id, v_order.id, 'infinity')
    on conflict (cell_id) do update
       set order_id = excluded.order_id, expires_at = 'infinity', created_at = now()
     where h.order_id = excluded.order_id or h.expires_at < now()
    returning h.cell_id into v_cell;
    v_conflict := v_cell is null;
  end if;

  update public.orders
     set status              = 'paid',
         burn_number         = v_number,
         provider            = p_provider,
         provider_payment_id = p_payment_id,
         paid_at             = now(),
         moderation_reason   = case when v_conflict then 'cell_conflict' else moderation_reason end
   where id = v_order.id;

  insert into public.gift_ledger (order_id, amount_amd) values (v_order.id, v_gift);

  if v_light then
    return json_build_object('ok', true, 'burn_number', null, 'already', false, 'cell_conflict', v_conflict);
  end if;
  return json_build_object('ok', true, 'burn_number', v_number, 'already', false);
end;
$$;

-- create or replace keeps the existing grants; restated for clarity.
revoke all on function public.confirm_payment(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, text, integer) to service_role;

-- -----------------------------------------------------------------------------
-- admin_mark_refunded — as in 0003, plus: frees the order's plot.
-- -----------------------------------------------------------------------------
create or replace function public.admin_mark_refunded(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_gift  integer;
  v_cell  integer;
begin
  select * into v_order from public.orders where code = p_code for update;
  if not found then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if v_order.status = 'refunded' then
    return json_build_object('ok', true, 'code', v_order.code, 'already', true);
  end if;
  if v_order.status <> 'paid' then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_PAID');
  end if;

  update public.orders set status = 'refunded' where id = v_order.id;
  delete from public.gift_ledger where order_id = v_order.id returning amount_amd into v_gift;
  delete from public.cell_holds where order_id = v_order.id returning cell_id into v_cell;

  insert into public.payment_events (provider, kind, order_code, payload)
  values (coalesce(v_order.provider, 'admin'), 'admin_refund', v_order.code,
          jsonb_build_object('amount_amd', v_order.amount_amd, 'gift_removed_amd', coalesce(v_gift, 0),
                             'provider_payment_id', v_order.provider_payment_id, 'burn_number', v_order.burn_number,
                             'cell_id', v_order.cell_id, 'cell_released', v_cell is not null));

  return json_build_object('ok', true, 'code', v_order.code, 'already', false, 'gift_removed_amd', coalesce(v_gift, 0));
end;
$$;

revoke all on function public.admin_mark_refunded(text) from public, anon, authenticated;
grant execute on function public.admin_mark_refunded(text) to service_role;

-- -----------------------------------------------------------------------------
-- admin_stats — papers_burned counts papers only; adds lights_lit,
-- lights_held (unexpired, unpaid holds) and lights_cell_conflict.
-- -----------------------------------------------------------------------------
create or replace function public.admin_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'orders_by_status', coalesce((select json_object_agg(status, n) from (
                           select status, count(*) as n from public.orders group by status) s), '{}'::json),
    'revenue_amd',        (select coalesce(sum(amount_amd), 0) from public.orders where status = 'paid'),
    'gift_fund_amd',      (select coalesce(sum(amount_amd), 0) from public.gift_ledger),
    'waitlist_count',     (select count(*) from public.waitlist),
    'papers_burned',      (select count(*) from public.orders
                            where status = 'paid' and product not in ('light', 'light_big')),
    'pending_moderation', (select count(*) from public.orders where moderation = 'pending' and status in ('paid', 'pending', 'awaiting_launch')),
    'lights_lit',         (select count(*) from public.cell_holds h join public.orders o on o.id = h.order_id
                            where h.expires_at = 'infinity' and o.status = 'paid'),
    'lights_held',        (select count(*) from public.cell_holds where expires_at > now() and expires_at <> 'infinity'),
    'lights_cell_conflict', (select count(*) from public.orders
                              where status = 'paid' and product in ('light', 'light_big') and moderation_reason = 'cell_conflict')
  );
$$;

revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to service_role;

-- -----------------------------------------------------------------------------
-- admin_list_orders — same as 0003, plus the light fields; q also searches
-- the signature.
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
           o.cell_id, o.light_icon, o.light_color, o.light_signature
      from public.orders o, q
     where (p_status is null or o.status = p_status)
       and (p_moderation is null or o.moderation = p_moderation)
       and (p_before_id is null or o.id < p_before_id)
       and (q.term is null
            or o.code like lower(q.term) || '%'
            or strpos(lower(coalesce(o.email, '')), lower(q.term)) > 0
            or strpos(lower(o.text), lower(q.term)) > 0
            or strpos(lower(coalesce(o.wish_text, '')), lower(q.term)) > 0
            or strpos(lower(coalesce(o.recipient_name, '')), lower(q.term)) > 0
            or strpos(lower(coalesce(o.light_signature, '')), lower(q.term)) > 0)
     order by o.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select coalesce(json_agg(rows order by rows.id desc), '[]'::json) from rows;
$$;

revoke all on function public.admin_list_orders(text, text, text, integer, bigint) from public, anon, authenticated;
grant execute on function public.admin_list_orders(text, text, text, integer, bigint) to service_role;

-- =============================================================================
-- Public RPCs
-- =============================================================================

-- { papers_burned, gift_fund_amd, wishes_kept, waitlist_count, lights_lit, updated_at }
create or replace function public.get_public_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'papers_burned',  (select count(*) from public.orders
                        where status = 'paid' and product not in ('light', 'light_big')),
    'gift_fund_amd',  (select coalesce(sum(amount_amd), 0) from public.gift_ledger),
    'wishes_kept',    (select count(*) from public.orders where status = 'paid' and wish_text is not null),
    'waitlist_count', (select count(*) from public.waitlist),
    'lights_lit',     (select count(*) from public.cell_holds h join public.orders o on o.id = h.order_id
                        where h.expires_at = 'infinity' and o.status = 'paid'),
    'updated_at',     now()
  );
$$;

-- Paid papers in burn order (lights excluded). Unchanged otherwise.
create or replace function public.get_fire_feed(after_number integer default 0, max_rows integer default 50)
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
     and o.product not in ('light', 'light_big')
     and o.burn_number > coalesce(after_number, 0)
   order by o.burn_number
   limit least(greatest(coalesce(max_rows, 50), 1), 100);
$$;

-- The whole map in one compact document:
-- { lit: [[cell_id, icon_index, color_index, big 0|1], ...], held: [cell_id, ...],
--   total, lit_count, by_province: { yer: n, ... }, updated_at }
-- icon_index / color_index are 0-based positions in
--   icons  tree home candle star gift pomegranate
--   colors amber red green white blue violet
create function public.get_map()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with lit as (
    select h.cell_id,
           array_position(array['tree', 'home', 'candle', 'star', 'gift', 'pomegranate'], o.light_icon) - 1 as icon_index,
           array_position(array['amber', 'red', 'green', 'white', 'blue', 'violet'], o.light_color) - 1 as color_index,
           case when o.product = 'light_big' then 1 else 0 end as big,
           c.province
      from public.cell_holds h
      join public.orders o    on o.id = h.order_id
      join public.map_cells c on c.id = h.cell_id
     where h.expires_at = 'infinity' and o.status = 'paid'
  ), provinces(code, sort) as (
    values ('yer', 1), ('ara', 2), ('arm', 3), ('ag', 4), ('kt', 5), ('gr', 6),
           ('sh', 7), ('lo', 8), ('tv', 9), ('vd', 10), ('su', 11)
  )
  select json_build_object(
    'lit',         coalesce((select json_agg(json_build_array(cell_id, icon_index, color_index, big) order by cell_id) from lit),
                            '[]'::json),
    'held',        coalesce((select json_agg(h.cell_id order by h.cell_id) from public.cell_holds h
                              where h.expires_at > now() and h.expires_at <> 'infinity'), '[]'::json),
    'total',       (select count(*) from public.map_cells),
    'lit_count',   (select count(*) from lit),
    'by_province', (select json_object_agg(p.code, (select count(*) from lit where lit.province = p.code) order by p.sort)
                      from provinces p),
    'updated_at',  now()
  );
$$;

-- One plot. null when p_cell_id is not a map plot.
-- { cell_id, province, town_index, status: free|held|lit, icon, color, big,
--   message, signature, lit_at } — icon/color/big/lit_at only when lit;
-- message/signature only when lit and moderation = 'approved'.
create function public.get_cell(p_cell_id integer)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'cell_id',    c.id,
    'province',   c.province,
    'town_index', c.town_index,
    'status',     case when o.id is not null then 'lit'
                       when h.expires_at > now() then 'held'
                       else 'free' end,
    'icon',       o.light_icon,
    'color',      o.light_color,
    'big',        coalesce(o.product = 'light_big', false),
    'message',    case when o.moderation = 'approved' then o.text end,
    'signature',  case when o.moderation = 'approved' then o.light_signature end,
    'lit_at',     o.paid_at
  )
    from public.map_cells c
    left join public.cell_holds h on h.cell_id = c.id
    left join public.orders o     on o.id = h.order_id and h.expires_at = 'infinity' and o.status = 'paid'
   where c.id = p_cell_id;
$$;

revoke all on function public.get_public_stats() from public;
revoke all on function public.get_fire_feed(integer, integer) from public;
revoke all on function public.get_map() from public;
revoke all on function public.get_cell(integer) from public;
grant execute on function public.get_public_stats() to anon, authenticated, service_role;
grant execute on function public.get_fire_feed(integer, integer) to anon, authenticated, service_role;
grant execute on function public.get_map() to anon, authenticated, service_role;
grant execute on function public.get_cell(integer) to anon, authenticated, service_role;
