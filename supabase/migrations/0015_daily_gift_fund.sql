-- =============================================================================
-- 0015_daily_gift_fund.sql — the public gift fund total moves once a day.
--
--   get_public_stats().gift_fund_amd now counts only gifts recorded before the
--   last midnight in Yerevan, so the number never jumps right after one
--   purchase. gift_fund_as_of says which midnight it is. Everything else is as
--   in 0013. The admin stats and the ledger itself are unchanged.
-- =============================================================================

create or replace function public.get_public_stats()
returns json
language sql
stable
security definer
set search_path = public
as $$
  with cut as (select date_trunc('day', now() at time zone 'Asia/Yerevan') at time zone 'Asia/Yerevan' as at)
  select json_build_object(
    'papers_burned',  (select count(*) from public.orders
                        where status = 'paid' and product not in ('light', 'light_big'))
                      + (select count(*) from public.fire_wishes w join public.orders o on o.id = w.order_id
                          where o.status = 'paid'),
    'gift_fund_amd',  (select coalesce(sum(g.amount_amd), 0) from public.gift_ledger g, cut where g.created_at < cut.at),
    'gift_fund_as_of', (select at from cut),
    'wishes_kept',    (select count(*) from public.orders where status = 'paid' and wish_text is not null),
    'waitlist_count', (select count(*) from public.waitlist),
    'lights_lit',     (select count(*) from public.cell_holds h join public.orders o on o.id = h.order_id
                        where h.expires_at = 'infinity' and o.status = 'paid'),
    'updated_at',     now()
  );
$$;

-- create or replace keeps the existing grants; restated unchanged.
revoke all on function public.get_public_stats() from public;
grant execute on function public.get_public_stats() to anon, authenticated, service_role;
