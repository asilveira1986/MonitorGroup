-- =====================================================================
-- Alertas em tela (mesmo formato do aviso de nova mensagem)
--  * msg_alert_alerts: abre no centro da tela os alertas do sistema e o
--    aviso de SLA excedido (padrão: ligado). Usa o mesmo tempo na tela e
--    o mesmo som do alerta de nova mensagem.
--  * sla_breaches(): grupos com mensagem sem resposta que já passaram do
--    tempo de resposta (SLA do grupo ou o padrão), com a mensagem que está
--    esperando. Mesma regra do Painel de grupos (tempo útil, se ligado).
-- =====================================================================

alter table public.app_settings
  add column if not exists msg_alert_alerts boolean not null default true;

create or replace function public.sla_breaches()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_f      jsonb;
  v_useful boolean := public.sla_business_time_only();
begin
  if not public.is_active_user() then
    raise exception 'not authorized';
  end if;
  v_f := public.indicator_filters(now(), now(), null, null);

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'group_id', x.id, 'group', x.name, 'pending_since', x.pending_since, 'pending_count', x.pending_count,
      'waiting_seconds', x.waited, 'sla_seconds', x.sla_s,
      'who', coalesce(pm.sender_name, pm.sender_phone, 'Cliente'), 'phone', pm.sender_phone,
      'body', left(pm.body, 300), 'type', pm.message_type
    ) order by x.pending_since)
    from (
      select g.id, g.name, g.pending_since, g.pending_count, g.pending_message_id,
             coalesce(g.sla_minutes, s.default_sla_minutes) * 60 as sla_s,
             extract(epoch from now() - g.pending_since)::int as waited,
             case when v_useful then public.business_seconds(g.pending_since, now(), v_f)
                  else extract(epoch from now() - g.pending_since)::int end as counted
      from public.groups g cross join public.app_settings s
      where g.monitored and g.removed_at is null and g.pending_since is not null
    ) x
    left join public.messages pm on pm.id = x.pending_message_id
    where x.counted > x.sla_s
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.sla_breaches() from public, anon;
grant execute on function public.sla_breaches() to authenticated;

notify pgrst, 'reload schema';
