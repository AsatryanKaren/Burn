-- =============================================================================
-- 0007_revoke_pg_net.sql — security-audit follow-up (L4).
--
-- pg_net (schema `net`) was enabled to smoke-test functions from SQL. Its
-- functions can make HTTP requests from the database, so the browser roles
-- must not reach them. No-op when the extension is not installed.
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'net') then
    revoke all on all functions in schema net from anon, authenticated, public;
    revoke usage on schema net from anon, authenticated;
  end if;
end
$$;
