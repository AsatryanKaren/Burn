-- =============================================================================
-- 0017_gift_share_35.sql — the gift fund gets 35% of every payment (was 20%).
--
--   * confirm_payment(): same as in 0005, only the share changes:
--     floor(600 * 35 / 100) = 210 AMD per place.
--   * gift_ledger rows written before this migration keep their amount.
--   * Must match GIFT_SHARE_PERCENT (money.ts) and gift_share_percent (site.json).
-- =============================================================================

create or replace function public.confirm_payment(p_code text, p_provider text, p_payment_id text, p_amount integer)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order    public.orders%rowtype;
  v_number   integer;
  v_gift     integer;
  v_light    boolean;
  v_cell     integer;
  v_conflict boolean := false;
begin
  if p_code is null or p_provider is null or p_payment_id is null or p_amount is null
     or p_provider not in ('mock', 'ameria', 'idram')
     or char_length(p_payment_id) not between 1 and 200 then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'INVALID_ARGS');
  end if;

  -- Serialize all confirmations of this order.
  select * into v_order from public.orders where code = p_code for update;
  if not found then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'ORDER_NOT_FOUND');
  end if;

  -- Idempotency per order: already paid.
  if v_order.status = 'paid' then
    if v_order.provider = p_provider and v_order.provider_payment_id = p_payment_id then
      return json_build_object('ok', true, 'burn_number', v_order.burn_number, 'already', true);
    end if;
    return json_build_object('ok', false, 'burn_number', v_order.burn_number, 'already', true,
                             'error', 'ORDER_PAID_BY_OTHER_PAYMENT');
  end if;

  if v_order.provider is not null and v_order.provider <> p_provider then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'PROVIDER_MISMATCH');
  end if;

  -- Idempotency per provider payment id: never count one payment for two orders.
  if exists (select 1 from public.orders where provider_payment_id = p_payment_id and id <> v_order.id) then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'PAYMENT_ID_USED');
  end if;

  if v_order.status not in ('pending', 'awaiting_launch', 'failed') then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'ORDER_NOT_PAYABLE');
  end if;

  if p_amount <> v_order.amount_amd then
    return json_build_object('ok', false, 'burn_number', null, 'already', false, 'error', 'AMOUNT_MISMATCH');
  end if;

  v_light  := v_order.product in ('light', 'light_big');
  v_number := case when v_light then null else nextval('public.burn_number_seq') end;
  v_gift   := (v_order.amount_amd * 35) / 100;  -- integer division = floor for positive amounts

  if v_light then
    -- Make the plot this order's forever: free, expired, or already held by this order.
    insert into public.cell_holds as h (cell_id, order_id, expires_at)
    values (v_order.cell_id, v_order.id, 'infinity')
    on conflict (cell_id) do update
       set order_id = excluded.order_id, expires_at = 'infinity', created_at = now()
     where h.order_id = excluded.order_id or h.expires_at < now()
    returning h.cell_id into v_cell;
    v_conflict := v_cell is null;
  end if;

  update public.orders
     set status              = 'paid',
         burn_number         = v_number,
         provider            = p_provider,
         provider_payment_id = p_payment_id,
         paid_at             = now(),
         moderation_reason   = case when v_conflict then 'cell_conflict' else moderation_reason end
   where id = v_order.id;

  insert into public.gift_ledger (order_id, amount_amd) values (v_order.id, v_gift);

  if v_light then
    return json_build_object('ok', true, 'burn_number', null, 'already', false, 'cell_conflict', v_conflict);
  end if;
  return json_build_object('ok', true, 'burn_number', v_number, 'already', false);
end;
$$;

revoke all on function public.confirm_payment(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.confirm_payment(text, text, text, integer) to service_role;
