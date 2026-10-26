-- =============================================================================
-- 0006_needs_refund.sql — security-audit follow-ups (L2, L5).
-- Requires 0005_lights (admin_stats keeps the lights counters).
--
--   * payment_events of kind 'needs_refund' are written by the payment
--     endpoints when confirm_payment answers ORDER_PAID_BY_OTHER_PAYMENT
--     (the buyer may have been charged twice); admin_stats counts them.
--   * release_rate_limit(): gives one count back in the current window. The
--     admin function counts every login attempt up front with
--     check_rate_limit (atomic) and releases it when the token was right.
-- =============================================================================

create index payment_events_needs_refund_idx on public.payment_events (created_at desc) where kind = 'needs_refund';

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
                              where status = 'paid' and product in ('light', 'light_big') and moderation_reason = 'cell_conflict'),
    'needs_refund',       (select count(*) from public.payment_events where kind = 'needs_refund')
  );
$$;

revoke all on function public.admin_stats() from public, anon, authenticated;
grant execute on function public.admin_stats() to service_role;

-- Gives back one count of the current fixed window (never below 0).
create function public.release_rate_limit(p_key text, p_window_seconds integer)
returns void
language sql
security definer
set search_path = public
as $$
  update public.rate_limits
     set count = count - 1
   where key = p_key
     and window_start = to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds)
     and count > 0;
$$;

revoke all on function public.release_rate_limit(text, integer) from public, anon, authenticated;
grant execute on function public.release_rate_limit(text, integer) to service_role;
