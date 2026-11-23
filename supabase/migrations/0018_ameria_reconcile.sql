-- =============================================================================
-- 0018_ameria_reconcile.sql — settle Ameriabank payments whose buyer never
-- came back from the bank page (closed the tab, lost the connection).
--
--   * ameria_pending_attempts(): InitPayments (payment_events kind 'init') of
--     orders still `pending` with Ameria, between a minimum and a maximum age,
--     oldest first; `latest` marks the newest attempt of each order (counted
--     over all its attempts, so a fresh new attempt keeps older ones from
--     being treated as the latest). service_role only.
--   * pg_cron job `ameria-reconcile`: every 3 minutes POSTs to the
--     ameria-reconcile function (pg_net; browser roles have no access to it,
--     see 0007). The function does nothing while PAYMENT_PROVIDER is not
--     `ameria`.
-- =============================================================================

create or replace function public.ameria_pending_attempts(
  p_min_age_seconds integer,
  p_max_age_hours   integer,
  p_limit           integer
)
returns table (
  code               text,
  status             text,
  amount_amd         integer,
  provider_order_num bigint,
  attempt_order_id   bigint,
  payment_id         text,
  attempt_at         timestamptz,
  latest             boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with inits as (
    select e.order_code,
           e.payload->>'OrderID'               as order_id_text,
           e.payload->'response'->>'PaymentID' as payment_id,
           e.created_at,
           row_number() over (partition by e.order_code order by e.created_at desc, e.id desc) as rn
      from public.payment_events e
     where e.provider = 'ameria'
       and e.kind = 'init'
       and e.order_code is not null
       and e.created_at > now() - make_interval(hours => greatest(p_max_age_hours, 1))
  )
  select o.code,
         o.status,
         o.amount_amd,
         o.provider_order_num,
         i.order_id_text::bigint,
         i.payment_id,
         i.created_at,
         i.rn = 1
    from inits i
    join public.orders o on o.code = i.order_code
   where o.status = 'pending'
     and o.provider = 'ameria'
     and i.order_id_text ~ '^[0-9]{1,18}$'
     and i.payment_id ~ '^[A-Za-z0-9-]{8,64}$'
     and i.created_at < now() - make_interval(secs => greatest(p_min_age_seconds, 0))
   order by i.created_at
   limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.ameria_pending_attempts(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.ameria_pending_attempts(integer, integer, integer) to service_role;

-- The schedule. pg_net is already installed (0007); pg_cron is enabled here.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Re-running the migration replaces the job instead of adding a second one.
select cron.unschedule(jobid) from cron.job where jobname = 'ameria-reconcile';
select cron.schedule(
  'ameria-reconcile',
  '*/3 * * * *',
  $job$
    select net.http_post(
      url := 'https://maqcaowpfhmqcavboszy.supabase.co/functions/v1/ameria-reconcile',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);
