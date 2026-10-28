-- =============================================================================
-- 0010_rooms.sql — every light comes with a small decorated 3D room.
--
-- Contract: docs/ARCHITECTURE.md "The room (3D room of a light)".
-- Requires 0005_lights (light products, get_cell). Apply after 0009_bloggers.
--
--   * orders.room jsonb null — the layout the buyer arranged:
--       { "v": 1, "wall": ..., "floor": ..., "glow": bool, "items": [[type, x, z, r], ...] }
--     Strict validation (keys, lists, ranges, <= 4096 bytes of compact JSON)
--     is done by validateRoom in the edge functions; the CHECKs here are a
--     backstop: only lights may have a room, it is an object with v = 1 and
--     at most 40 items, and its size is bounded.
--   * get_cell(p_cell_id) gains `room` (the lit plot's layout, else null).
--     Everything it returned before (0005) is unchanged.
--
-- The room is structured data with no free text, so it is never moderated
-- and get_cell returns it for every lit plot.
-- =============================================================================

alter table public.orders
  add column room jsonb;

alter table public.orders
  -- Only light products carry a room.
  add constraint orders_room_light_only check (room is null or product in ('light', 'light_big')),
  -- Shape and size backstop. jsonb's text form adds a space after every ':' and
  -- ',', so it is larger than the compact JSON the functions limit to 4096
  -- bytes; 8192 bounds both the text form and the stored size.
  add constraint orders_room_shape check (
    room is null or (
      jsonb_typeof(room) = 'object'
      and room -> 'v' = '1'::jsonb
      and jsonb_typeof(room -> 'items') = 'array'
      and jsonb_array_length(room -> 'items') <= 40
      and octet_length(room::text) <= 8192
      and pg_column_size(room) <= 8192
    )
  );

-- -----------------------------------------------------------------------------
-- get_cell — as in 0005, plus `room` for lit plots (null otherwise).
-- { cell_id, province, town_index, status: free|held|lit, icon, color, big,
--   message, signature, lit_at, room } — icon/color/big/lit_at/room only when
-- lit; message/signature only when lit and moderation = 'approved'.
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
    'room',       o.room
  )
    from public.map_cells c
    left join public.cell_holds h on h.cell_id = c.id
    left join public.orders o     on o.id = h.order_id and h.expires_at = 'infinity' and o.status = 'paid'
   where c.id = p_cell_id;
$$;

-- create or replace keeps the existing grants (0005); restated unchanged.
revoke all on function public.get_cell(integer) from public;
grant execute on function public.get_cell(integer) to anon, authenticated, service_role;
