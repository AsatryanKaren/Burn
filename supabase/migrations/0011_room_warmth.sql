-- =============================================================================
-- 0011_room_warmth.sql — visitors of a lit plot's 3D room can "send warmth"
-- to its owner (once per IP hash), and room visits are counted. Both numbers
-- are public.
--
-- Contract: docs/ARCHITECTURE.md "Warmth and visits (migration 0011)".
-- Requires 0005_lights (cell_holds, get_map) and 0010_rooms (latest get_cell).
-- Apply after 0010_rooms. Apply once.
--
--   * room_stats(cell_id pk, order_id, warmth, visits, updated_at): the
--     counters of a plot's room. `order_id` is the paid light the counters
--     belong to: if a plot is refunded and lit again by someone else, the
--     new owner starts from 0 (the next write resets the row and the warmth
--     log; reads ignore a row whose order_id is not the current light).
--   * room_warmth_log(cell_id, ip_hash, created_at, pk(cell_id, ip_hash)):
--     one warmth per IP hash per room.
--   * room_add_warmth(p_cell_id, p_ip_hash) / room_add_visit(p_cell_id):
--     service_role only (called by the room-warmth edge function).
--   * get_cell gains `warmth`, `visits` (0 when there is no row); everything
--     it returned in 0010 is unchanged.
--   * get_map gains `warm`: [[cell_id, warmth], ...], the top 50 lit rooms by
--     warmth; everything it returned in 0005 is unchanged.
--
-- "Lit" is the same everywhere (get_map, get_cell, admin_stats): a cell_holds
-- row with expires_at = 'infinity' whose order is 'paid'.
-- Tables follow the waitlist/blogger model: RLS on, no policies, no
-- anon/authenticated privileges, service_role only.
-- =============================================================================

create table public.room_stats (
  cell_id    integer     primary key references public.map_cells(id) on delete restrict,
  -- The paid light these counters belong to (null after that order was deleted).
  order_id   bigint      references public.orders(id) on delete set null,
  warmth     integer     not null default 0,
  visits     integer     not null default 0,
  updated_at timestamptz not null default now(),
  constraint room_stats_warmth_nonneg check (warmth >= 0),
  constraint room_stats_visits_nonneg check (visits >= 0)
);

-- "warmest rooms" list in get_map
create index room_stats_warmth_idx on public.room_stats (warmth desc, cell_id) where warmth > 0;

create table public.room_warmth_log (
  cell_id    integer     not null references public.map_cells(id) on delete restrict,
  ip_hash    text        not null,
  created_at timestamptz not null default now(),
  primary key (cell_id, ip_hash),
  constraint room_warmth_log_ip_hash_format check (ip_hash ~ '^[0-9a-f]{64}$')
);

alter table public.room_stats      enable row level security;
alter table public.room_warmth_log enable row level security;

revoke all on table public.room_stats      from public, anon, authenticated;
revoke all on table public.room_warmth_log from public, anon, authenticated;
grant select, insert, update, delete on table public.room_stats      to service_role;
grant select, insert, update, delete on table public.room_warmth_log to service_role;

-- -----------------------------------------------------------------------------
-- room_stats_prepare (internal): the plot's current paid light, with its
-- room_stats row present, locked for this transaction and belonging to that
-- light (reset to 0 + warmth log cleared when the plot changed owner).
-- Returns the order id, or null when the plot is not lit.
-- -----------------------------------------------------------------------------
create function public.room_stats_prepare(p_cell_id integer)
returns bigint
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order       bigint;
  v_stats_order bigint;
begin
  if p_cell_id is null then
    return null;
  end if;

  select o.id into v_order
    from public.cell_holds h
    join public.orders o on o.id = h.order_id
   where h.cell_id = p_cell_id and h.expires_at = 'infinity' and o.status = 'paid';
  if v_order is null then
    return null;
  end if;

  insert into public.room_stats (cell_id, order_id) values (p_cell_id, v_order)
  on conflict (cell_id) do nothing;

  select s.order_id into v_stats_order from public.room_stats s where s.cell_id = p_cell_id for update;

  if v_stats_order is distinct from v_order then
    update public.room_stats
       set order_id = v_order, warmth = 0, visits = 0, updated_at = now()
     where cell_id = p_cell_id;
    delete from public.room_warmth_log where cell_id = p_cell_id;
  end if;

  return v_order;
end;
$$;

-- -----------------------------------------------------------------------------
-- room_add_warmth: one warmth per IP hash per lit room.
--   lit, first time   -> { "ok": true,  "warmth": n, "already": false }
--   lit, again        -> { "ok": true,  "warmth": n, "already": true }  (unchanged)
--   not lit / no plot -> { "ok": false, "error": "NOT_LIT" }
--   bad ip hash       -> { "ok": false, "error": "INVALID_ARGS" }
-- -----------------------------------------------------------------------------
create function public.room_add_warmth(p_cell_id integer, p_ip_hash text)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order    bigint;
  v_inserted integer;
  v_warmth   integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return json_build_object('ok', false, 'error', 'INVALID_ARGS');
  end if;

  v_order := public.room_stats_prepare(p_cell_id);
  if v_order is null then
    return json_build_object('ok', false, 'error', 'NOT_LIT');
  end if;

  insert into public.room_warmth_log (cell_id, ip_hash) values (p_cell_id, p_ip_hash)
  on conflict (cell_id, ip_hash) do nothing;
  get diagnostics v_inserted = row_count;

  if v_inserted = 1 then
    update public.room_stats
       set warmth = warmth + 1, updated_at = now()
     where cell_id = p_cell_id
    returning warmth into v_warmth;
  else
    select warmth into v_warmth from public.room_stats where cell_id = p_cell_id;
  end if;

  return json_build_object('ok', true, 'warmth', v_warmth, 'already', v_inserted = 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- room_add_visit: counts one visit of a lit room.
--   lit               -> { "ok": true,  "visits": n }
--   not lit / no plot -> { "ok": false, "error": "NOT_LIT" }
-- -----------------------------------------------------------------------------
create function public.room_add_visit(p_cell_id integer)
returns json
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order  bigint;
  v_visits integer;
begin
  v_order := public.room_stats_prepare(p_cell_id);
  if v_order is null then
    return json_build_object('ok', false, 'error', 'NOT_LIT');
  end if;

  update public.room_stats
     set visits = visits + 1, updated_at = now()
   where cell_id = p_cell_id
  returning visits into v_visits;

  return json_build_object('ok', true, 'visits', v_visits);
end;
$$;

revoke all on function public.room_stats_prepare(integer)     from public, anon, authenticated;
revoke all on function public.room_add_warmth(integer, text)  from public, anon, authenticated;
revoke all on function public.room_add_visit(integer)         from public, anon, authenticated;
grant execute on function public.room_stats_prepare(integer)    to service_role;
grant execute on function public.room_add_warmth(integer, text) to service_role;
grant execute on function public.room_add_visit(integer)        to service_role;

-- -----------------------------------------------------------------------------
-- get_cell — as in 0010, plus `warmth` and `visits` (integers, 0 when the plot
-- is not lit or has no counters yet; counters of a previous owner of the plot
-- are not shown).
-- { cell_id, province, town_index, status: free|held|lit, icon, color, big,
--   message, signature, lit_at, room, warmth, visits }
-- -----------------------------------------------------------------------------
create or replace function public.get_cell(p_cell_id integer)
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
    'lit_at',     o.paid_at,
    'room',       o.room,
    'warmth',     coalesce(s.warmth, 0),
    'visits',     coalesce(s.visits, 0)
  )
    from public.map_cells c
    left join public.cell_holds h on h.cell_id = c.id
    left join public.orders o     on o.id = h.order_id and h.expires_at = 'infinity' and o.status = 'paid'
    left join public.room_stats s on s.cell_id = c.id and s.order_id = o.id
   where c.id = p_cell_id;
$$;

-- -----------------------------------------------------------------------------
-- get_map — as in 0005, plus `warm`: [[cell_id, warmth], ...] for the top 50
-- lit rooms with warmth > 0, warmest first (ties: lower cell_id first).
-- -----------------------------------------------------------------------------
create or replace function public.get_map()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with lit as (
    select h.cell_id,
           o.id as order_id,
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
  ), warm as (
    select s.cell_id, s.warmth
      from public.room_stats s
      join lit on lit.cell_id = s.cell_id and lit.order_id = s.order_id
     where s.warmth > 0
     order by s.warmth desc, s.cell_id
     limit 50
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
    'warm',        coalesce((select json_agg(json_build_array(cell_id, warmth) order by warmth desc, cell_id) from warm),
                            '[]'::json),
    'updated_at',  now()
  );
$$;

-- create or replace keeps the existing grants (0005); restated unchanged.
revoke all on function public.get_cell(integer) from public;
revoke all on function public.get_map()         from public;
grant execute on function public.get_cell(integer) to anon, authenticated, service_role;
grant execute on function public.get_map()         to anon, authenticated, service_role;
