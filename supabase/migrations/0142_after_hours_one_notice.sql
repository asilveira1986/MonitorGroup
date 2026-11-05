-- =====================================================================
-- Aviso fora do expediente: um só aviso por grupo, com a última mensagem do cliente.
--
--  * O mesmo grupo do WhatsApp existe uma vez por número conectado (cada um pode estar num setor).
--    A verificação devolve agora também o identificador do grupo no WhatsApp (group_jid) e o horário
--    da última mensagem do cliente, para o worker juntar as cópias num único aviso.
--  * A mensagem mostrada é a última mensagem do cliente no grupo (não apagada), e não a primeira
--    sem resposta.
--  * Mudou o tipo de retorno: a função é recriada.
-- =====================================================================

drop function if exists public.after_hours_sla_candidates(uuid);
create function public.after_hours_sla_candidates(p_company_id uuid)
returns table (
  alert_group_id uuid, group_id uuid, group_name text, group_jid text, pending_since timestamptz, pending_count int,
  sla_seconds int, waiting_seconds int, who text, body text, message_type text, last_client_at timestamptz
)
language plpgsql security definer set search_path = public as $$
declare
  v_f     jsonb;
  v_alert uuid;
begin
  perform set_config('app.company_id', p_company_id::text, true);
  select s.after_hours_alert_group_id into v_alert from public.app_settings s where s.company_id = p_company_id;
  if v_alert is null then
    return;
  end if;
  v_f := public.indicator_filters(now(), now(), null, null);
  if v_f is null then
    return;
  end if;
  -- dentro do expediente quem cuida dos avisos são os alertas normais
  if public.is_business_time(now(), v_f) then
    return;
  end if;
  return query
  select v_alert, g.id, g.name, g.jid, g.pending_since, g.pending_count,
         (coalesce(s.after_hours_alert_minutes, g.sla_minutes, s.default_sla_minutes) * 60)::int,
         extract(epoch from now() - g.pending_since)::int,
         coalesce(lm.sender_name, lm.sender_phone, 'Cliente'), left(lm.body, 200), lm.message_type, lm.sent_at
    from public.groups g
    join public.app_settings s on s.company_id = g.company_id
    left join lateral (
      select m.sender_name, m.sender_phone, m.body, m.message_type, m.sent_at
        from public.messages m
       where m.group_id = g.id and not m.from_team and m.deleted_at is null and m.hidden_at is null
       order by m.sent_at desc limit 1
    ) lm on true
   where g.company_id = p_company_id and g.monitored and g.removed_at is null
     and g.id <> v_alert
     and g.pending_since is not null
     -- o prazo já venceu...
     and g.pending_since + make_interval(mins => coalesce(s.after_hours_alert_minutes, g.sla_minutes, s.default_sla_minutes)) <= now()
     -- ...e a pendência não é antiga demais
     and g.pending_since >= now() - interval '2 days'
     and not exists (select 1 from public.after_hours_sla_notices n where n.group_id = g.id and n.pending_since = g.pending_since)
   order by g.pending_since;
end;
$$;
revoke all on function public.after_hours_sla_candidates(uuid) from public, anon, authenticated;
grant execute on function public.after_hours_sla_candidates(uuid) to service_role;

notify pgrst, 'reload schema';
