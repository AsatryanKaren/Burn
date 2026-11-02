-- =============================================================================
-- 0014_price_600.sql — one price: everything costs 600 AMD.
--
--   * `products` stays the source of truth; site.json only shows the price and
--     must match. `burn` is retired since 0013 but keeps the same price so the
--     table still says "one price".
--   * The 20% gift share follows: floor(600 * 20 / 100) = 120 AMD.
--   * Orders already created keep their own amount; confirm_payment compares
--     with the order, not with this table.
-- =============================================================================

update public.products set price_amd = 600 where code in ('burn', 'light');
