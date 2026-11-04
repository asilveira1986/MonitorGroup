-- =====================================================================
-- Grupo de alertas fora do expediente: minutos sem resposta para avisar.
--
--  * app_settings.after_hours_alert_minutes: depois de quantos minutos sem resposta o aviso é enviado
--    ao grupo de alertas (0139). Vazio: usa o SLA de cada grupo (o do grupo ou o padrão da empresa).
--  * O aviso continua valendo só quando esse prazo vence fora do expediente (ou em feriado).
-- =====================================================================

alter table public.app_settings
  add column if not exists after_hours_alert_minutes int check (after_hours_alert_minutes is null or after_hours_alert_minutes > 0);

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
     -- o prazo (minutos configurados ou o SLA) venceu agora há pouco (evita avisar pendências antigas)...
     and g.pending_since + make_interval(mins => coalesce(s.after_hours_alert_minutes, g.sla_minutes, s.default_sla_minutes)) <= now()
     and g.pending_since + make_interval(mins => coalesce(s.after_hours_alert_minutes, g.sla_minutes, s.default_sla_minutes)) >= now() - interval '6 hours'
     -- ...e o instante em que venceu foi fora do expediente
     and not public.is_business_time(
           g.pending_since + make_interval(mins => coalesce(s.after_hours_alert_minutes, g.sla_minutes, s.default_sla_minutes)), v_f)
     and not exists (select 1 from public.after_hours_sla_notices n where n.group_id = g.id and n.pending_since = g.pending_since)
   order by g.pending_since;
end;
$$;
revoke all on function public.after_hours_sla_candidates(uuid) from public, anon, authenticated;
grant execute on function public.after_hours_sla_candidates(uuid) to service_role;

notify pgrst, 'reload schema';
