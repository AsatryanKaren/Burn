-- =============================================================================
-- 0009_bloggers.sql — blogger applications for the December 31 gift delivery.
-- Requires 0003_admin (admin_export) and 0006_needs_refund (latest
-- admin_stats; everything it returns is kept).
--
--   * blogger_applications: written only by the join-bloggers edge function
--     (service_role). RLS on, no policies, no anon/authenticated privileges —
--     the same model as `waitlist`.
--   * admin_export('bloggers') for the admin `bloggers_csv` action.
--   * admin_stats gains `bloggers_count`.
--
-- Apply once.
-- =============================================================================

create table public.blogger_applications (
  id         bigserial   primary key,
  name       text        not null,
  link       text        not null,
  platform   text,
  audience   text,
  email      text        not null,
  phone      text,
  message    text,
  lang       text        not null default 'hy',
  ip_hash    text,
  created_at timestamptz not null default now(),
  status     text        not null default 'new',
  constraint blogger_applications_name_len      check (char_length(name) between 1 and 80),
  constraint blogger_applications_link_len      check (char_length(link) between 1 and 300),
  constraint blogger_applications_link_http     check (link ~* '^https?://[^[:space:]]+$'),
  constraint blogger_applications_platform_enum check (platform is null or platform in ('instagram', 'tiktok', 'youtube', 'facebook', 'telegram', 'other')),
  constraint blogger_applications_audience_len  check (audience is null or char_length(audience) between 1 and 40),
  constraint blogger_applications_email_lower   check (email = lower(email)),
  constraint blogger_applications_email_format  check (char_length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint blogger_applications_phone_len     check (phone is null or char_length(phone) between 1 and 30),
  constraint blogger_applications_message_len   check (message is null or char_length(message) between 1 and 500),
  constraint blogger_applications_lang_enum     check (lang in ('hy', 'en', 'ru')),
  constraint blogger_applications_ip_hash_format check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  constraint blogger_applications_status_enum   check (status in ('new', 'contacted', 'accepted', 'declined'))
);

create index blogger_applications_created_idx on public.blogger_applications (created_at desc);
create index blogger_applications_email_idx   on public.blogger_applications (email);

alter table public.blogger_applications enable row level security;

revoke all on table    public.blogger_applications        from public, anon, authenticated;
revoke all on sequence public.blogger_applications_id_seq from public, anon, authenticated;
grant select, insert, update, delete on table public.blogger_applications to service_role;
grant usage, select on sequence public.blogger_applications_id_seq       to service_role;

-- -----------------------------------------------------------------------------
-- admin_export: 0003's kinds unchanged, plus 'bloggers' (oldest first).
-- -----------------------------------------------------------------------------
create or replace function public.admin_export(p_kind text)
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
    when 'bloggers' then (
      select coalesce(json_agg(json_build_object('id', id, 'created_at', created_at, 'status', status, 'name', name,
                                                 'link', link, 'platform', platform, 'audience', audience,
                                                 'email', email, 'phone', phone, 'message', message,
                                                 'lang', lang) order by id), '[]'::json)
        from public.blogger_applications)
    else null
  end;
$$;

-- -----------------------------------------------------------------------------
-- admin_stats: 0006's definition + bloggers_count.
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
                              where status = 'paid' and product in ('light', 'light_big') and moderation_reason = 'cell_conflict'),
    'needs_refund',       (select count(*) from public.payment_events where kind = 'needs_refund'),
    'bloggers_count',     (select count(*) from public.blogger_applications)
  );
$$;

-- create or replace keeps the existing grants; restated for clarity.
revoke all on function public.admin_export(text) from public, anon, authenticated;
revoke all on function public.admin_stats()      from public, anon, authenticated;
grant execute on function public.admin_export(text) to service_role;
grant execute on function public.admin_stats()      to service_role;
