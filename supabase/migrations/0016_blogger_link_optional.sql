-- =============================================================================
-- 0016_blogger_link_optional.sql — anyone may apply to join the gift delivery.
--
--   blogger_applications.link becomes optional (people without a social page
--   can apply too). The length and http(s) checks still apply when a link is
--   given; a CHECK passes on null.
-- =============================================================================

alter table public.blogger_applications alter column link drop not null;
