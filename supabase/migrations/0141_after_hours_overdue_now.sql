-- =====================================================================
-- Grupo de alertas fora do expediente: avisa também as pendências que viraram a noite.
--
--  * Antes (0139/0140) o aviso só saía quando o prazo vencia fora do expediente. Uma mensagem que
--    venceu às 16h e continuou sem resposta depois das 18h nunca era avisada.
--  * Agora o aviso sai quando o grupo está com o prazo vencido (os minutos configurados ou o SLA do
--    grupo) E o horário de agora é fora do expediente (dias úteis, horário e feriados), uma vez por
--    pendência. Quem vence já fora do expediente continua sendo avisado na hora.
--  * Só entram pendências dos últimos 2 dias (evita avisar pendências muito antigas).
-- =====================================================================

create or replace function public.after_hours_sla_candidates(p_company_id uuid)
returns table (
  alert_group_id uuid, group_id uuid, group_name text, pending_since timestamptz, pending_count int,
  sla_seconds int, waiting_seconds int, who text, body text, message_type text
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
  select v_alert, g.id, g.name, g.pending_since, g.pending_count,
         (coalesce(s.after_hours_alert_minutes, g.sla_minutes, s.default_sla_minutes) * 60)::int,
         extract(epoch from now() - g.pending_since)::int,
         coalesce(pm.sender_name, pm.sender_phone, 'Cliente'), left(pm.body, 200), pm.message_type
    from public.groups g
    join public.app_settings s on s.company_id = g.company_id
    left join public.messages pm on pm.id = g.pending_message_id
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
