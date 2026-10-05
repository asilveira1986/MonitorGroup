-- =====================================================================
-- Alerta de reincidência de falta de resposta.
--
-- Regra do tipo "recurrence": avisa quando um grupo acumula
-- threshold_count falhas de resposta (fora do SLA ou ainda sem resposta)
-- nos últimos threshold_minutes (a tela mostra em dias).
-- Segue o indicador "reincidencia_sem_resposta": com o indicador ou o
-- alerta dele desligado, a regra não dispara.
-- =====================================================================

alter table public.alert_rules drop constraint if exists alert_rules_type_check;
alter table public.alert_rules add constraint alert_rules_type_check
  check (type in ('no_response', 'keyword', 'high_volume', 'disconnected', 'inactivity', 'deadline_missed', 'rework', 'recurrence'));

-- o indicador passa a ter alerta (ligado por padrão)
update public.indicators
set supports_alert = true, default_alert_enabled = true
where key = 'reincidencia_sem_resposta';
update public.indicators
set alert_enabled = true
where key = 'reincidencia_sem_resposta' and updated_by is null;

-- regra padrão: 3 falhas em 7 dias, no máximo um aviso por dia por grupo
insert into public.alert_rules (name, type, severity, threshold_count, threshold_minutes, cooldown_minutes, indicator_key)
select 'Grupo reincidente sem resposta', 'recurrence', 'warning', 3, 7 * 1440, 1440, 'reincidencia_sem_resposta'
where not exists (select 1 from public.alert_rules where type = 'recurrence');

-- grupos que atingiram o limite na janela (usado pelo worker)
create or replace function public.recurrence_alert_candidates(p_window_minutes int, p_min_failures int)
returns table (group_id uuid, group_name text, failures int, last_failure timestamptz, worst_seconds int)
language sql stable security definer set search_path = public
as $$
  select x.group_id, x.group_name, count(*)::int, max(x.asked_at), max(x.delay_seconds)
  from public.ind_response_failures(
    public.indicator_filters(now() - make_interval(mins => greatest(p_window_minutes, 60)), now(), null, null)
  ) x
  group by x.group_id, x.group_name
  having count(*) >= greatest(p_min_failures, 1)
$$;

revoke all on function public.recurrence_alert_candidates(int, int) from public, anon, authenticated;
grant execute on function public.recurrence_alert_candidates(int, int) to service_role;

notify pgrst, 'reload schema';
