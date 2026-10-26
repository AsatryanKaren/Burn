-- =============================================================================
-- 0003_admin.sql — internal functions behind the `admin` Edge Function.
-- All are SECURITY DEFINER and executable by service_role only; the edge
-- function authenticates the admin (x-admin-token) before calling them.
-- =============================================================================

-- Current count of a rate-limit window without incrementing it.
create function public.peek_rate_limit(p_key text, p_window_seconds integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select count from public.rate_limits
     where key = p_key
       and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)
  ), 0);
$$;

-- { orders_by_status, revenue_amd, gift_fund_amd, waitlist_count, papers_burned, pending_moderation }
create function public.admin_stats()
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
    'papers_burned',      (select count(*) from public.orders where status = 'paid'),
    'pending_moderation', (select count(*) from public.orders where moderation = 'pending' and status in ('paid', 'pending', 'awaiting_launch'))
  );
$$;

-- Newest first, keyset pagination by id. p_q searches code (prefix), email,
-- text, wish_text and recipient_name (case-insensitive substring).
create function public.admin_list_orders(
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
           o.created_at, o.paid_at
      from public.orders o, q
     where (p_status is null or o.status = p_status)
       and (p_moderation is null or o.moderation = p_moderation)
       and (p_before_id is null or o.id < p_before_id)
       and (q.term is null
            or o.code like lower(q.term) || '%'
            or strpos(lower(coalesce(o.email, '')), lower(q.term)) > 0
            or strpos(lower(o.text), lower(q.term)) > 0
            or strpos(lower(coalesce(o.wish_text, '')), lower(q.term)) > 0
            or strpos(lower(coalesce(o.recipient_name, '')), lower(q.term)) > 0)
     order by o.id desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select coalesce(json_agg(rows order by rows.id desc), '[]'::json) from rows;
$$;

create function public.admin_moderate(p_code text, p_moderation text, p_reason text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if p_moderation not in ('approved', 'hidden', 'rejected') then
    return json_build_object('ok', false, 'error', 'INVALID_MODERATION');
  end if;
  update public.orders
     set moderation = p_moderation,
         moderation_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 200)
   where code = p_code
  returning code into v_code;
  if v_code is null then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  return json_build_object('ok', true, 'code', v_code, 'moderation', p_moderation);
end;
$$;

-- Paid -> refunded. Removes the order's gift_ledger row so the public fund
-- total stays correct, and writes an audit row to payment_events. Atomic.
create function public.admin_mark_refunded(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_gift  integer;
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

  insert into public.payment_events (provider, kind, order_code, payload)
  values (coalesce(v_order.provider, 'admin'), 'admin_refund', v_order.code,
          jsonb_build_object('amount_amd', v_order.amount_amd, 'gift_removed_amd', coalesce(v_gift, 0),
                             'provider_payment_id', v_order.provider_payment_id, 'burn_number', v_order.burn_number));

  return json_build_object('ok', true, 'code', v_order.code, 'already', false, 'gift_removed_amd', coalesce(v_gift, 0));
end;
$$;

-- Rows for CSV exports: p_kind = 'waitlist' | 'awaiting_launch'.
create function public.admin_export(p_kind text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select case p_kind
    when 'waitlist' then (
      select coalesce(json_agg(json_build_object('email', email, 'lang', lang, 'created_at', created_at) order by id), '[]'::json)
        from public.waitlist)
    when 'awaiting_launch' then (
      select coalesce(json_agg(json_build_object('email', email, 'lang', lang, 'code', code, 'product', product,
                                                 'amount_amd', amount_amd, 'created_at', created_at) order by id), '[]'::json)
        from public.orders where status = 'awaiting_launch' and email is not null)
    else null
  end;
$$;

revoke all on function public.peek_rate_limit(text, integer) from public, anon, authenticated;
revoke all on function public.admin_stats() from public, anon, authenticated;
revoke all on function public.admin_list_orders(text, text, text, integer, bigint) from public, anon, authenticated;
revoke all on function public.admin_moderate(text, text, text) from public, anon, authenticated;
revoke all on function public.admin_mark_refunded(text) from public, anon, authenticated;
revoke all on function public.admin_export(text) from public, anon, authenticated;

grant execute on function public.peek_rate_limit(text, integer) to service_role;
grant execute on function public.admin_stats() to service_role;
grant execute on function public.admin_list_orders(text, text, text, integer, bigint) to service_role;
grant execute on function public.admin_moderate(text, text, text) to service_role;
grant execute on function public.admin_mark_refunded(text) to service_role;
grant execute on function public.admin_export(text) to service_role;
