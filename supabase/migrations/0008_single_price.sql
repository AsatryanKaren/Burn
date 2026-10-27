-- =============================================================================
-- 0008_single_price.sql — one price: everything costs 500 AMD.
-- Requires 0005_lights (the `light` / `light_big` rows).
--
--   * Sold: `burn` (500, a paper burned in the fire) and `light` (500, a light
--     on the map). The 20% gift share stays: floor(500 * 20 / 100) = 100 AMD.
--   * No longer sold: `burn_wish`, `gift`, `midnight`, `light_big`. Their rows
--     stay (old orders reference them; prices unchanged for the record) with
--     active = false. create-order and start-payment answer
--     400 PRODUCT_UNAVAILABLE for them. The code paths (wish, recipient, big
--     light) are kept, just unreachable while the rows are inactive.
--   * Unpaid saved lights (`awaiting_launch` / `failed`, i.e. no payment in
--     flight at a bank) are re-priced to 500 so start-payment charges the new
--     price. `pending` orders are left alone: a bank payment may already be
--     open for the old amount and confirm_payment checks the amount.
--
-- Safe to re-run.
-- =============================================================================

update public.products set price_amd = 500, active = true  where code in ('burn', 'light');
update public.products set active = false                  where code in ('burn_wish', 'gift', 'midnight', 'light_big');

update public.orders
   set amount_amd = 500
 where product = 'light'
   and status in ('awaiting_launch', 'failed')
   and amount_amd <> 500;
