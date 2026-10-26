-- =============================================================================
-- 0002_payment_attempts.sql — support for start-payment (pay a saved order).
--
-- begin_payment_attempt() atomically moves a payable order
-- (awaiting_launch | pending | failed) to `pending` with the given provider,
-- optionally allocating a fresh provider_order_num (Ameriabank needs a new
-- numeric OrderID for every InitPayment). It never marks anything paid.
-- =============================================================================

-- Returns json:
--   { ok: true, code, status: 'pending', provider, provider_order_num, amount_amd, lang, email }
--   { ok: false, error: 'INVALID_ARGS' | 'ORDER_NOT_FOUND' | 'ALREADY_PAID' | 'ORDER_NOT_PAYABLE' }
create function public.begin_payment_attempt(p_code text, p_provider text, p_new_order_num boolean default false)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_code is null or p_provider is null or p_provider not in ('mock', 'ameria', 'idram') then
    return json_build_object('ok', false, 'error', 'INVALID_ARGS');
  end if;

  select * into v_order from public.orders where code = p_code for update;
  if not found then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_FOUND');
  end if;
  if v_order.status = 'paid' then
    return json_build_object('ok', false, 'error', 'ALREADY_PAID');
  end if;
  if v_order.status not in ('awaiting_launch', 'pending', 'failed') then
    return json_build_object('ok', false, 'error', 'ORDER_NOT_PAYABLE');
  end if;

  update public.orders
     set status             = 'pending',
         provider           = p_provider,
         provider_order_num = case when coalesce(p_new_order_num, false)
                                   then nextval('public.provider_order_num_seq')
                                   else provider_order_num end
   where id = v_order.id
  returning * into v_order;

  return json_build_object(
    'ok', true,
    'code', v_order.code,
    'status', v_order.status,
    'provider', v_order.provider,
    'provider_order_num', v_order.provider_order_num,
    'amount_amd', v_order.amount_amd,
    'lang', v_order.lang,
    'email', v_order.email
  );
end;
$$;

revoke all on function public.begin_payment_attempt(text, text, boolean) from public, anon, authenticated;
grant execute on function public.begin_payment_attempt(text, text, boolean) to service_role;
