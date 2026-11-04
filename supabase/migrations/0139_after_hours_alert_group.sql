-- =====================================================================
-- Grupo de alertas fora do expediente.
--
--  * Em Configurações › Regras de alerta, o administrador escolhe um grupo do WhatsApp (o número
--    conectado precisa participar dele). Sempre que o tempo de resposta (SLA) de um grupo estoura
--    FORA do horário de trabalho, o sistema avisa nesse grupo, uma vez por pendência.
--  * "Estoura fora do horário": o SLA conta em tempo corrido a partir da mensagem do cliente
--    (mensagem + SLA do grupo, ou o padrão) e o instante em que ele vence cai fora do expediente,
--    dos dias úteis ou dos feriados cadastrados. Não depende de a empresa contar o SLA só em
--    horário comercial, porque o aviso existe justamente para quando ninguém está olhando.
--  * after_hours_sla_notices guarda o que já foi avisado (uma linha por pendência).
-- =====================================================================

alter table public.app_settings
  add column if not exists after_hours_alert_group_id uuid references public.groups(id) on delete set null;

create table if not exists public.after_hours_sla_notices (
  group_id      uuid not null references public.groups(id) on delete cascade,
  pending_since timestamptz not null,
  notified_at   timestamptz not null default now(),
  primary key (group_id, pending_since)
);
-- só o worker (chave de serviço) lê e grava
alter table public.after_hours_sla_notices enable row level security;

-- grupos com o SLA vencido fora do expediente que ainda não foram avisados
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
         (coalesce(g.sla_minutes, s.default_sla_minutes) * 60)::int,
         extract(epoch from now() - g.pending_since)::int,
         coalesce(pm.sender_name, pm.sender_phone, 'Cliente'), left(pm.body, 200), pm.message_type
    from public.groups g
    join public.app_settings s on s.company_id = g.company_id
    left join public.messages pm on pm.id = g.pending_message_id
   where g.company_id = p_company_id and g.monitored and g.removed_at is null
     and g.id <> v_alert
     and g.pending_since is not null
     -- o SLA venceu agora há pouco (evita avisar pendências antigas, por exemplo na primeira execução)...
     and g.pending_since + make_interval(secs => coalesce(g.sla_minutes, s.default_sla_minutes) * 60) <= now()
     and g.pending_since + make_interval(secs => coalesce(g.sla_minutes, s.default_sla_minutes) * 60) >= now() - interval '6 hours'
     -- ...e o instante em que venceu foi fora do expediente
     and not public.is_business_time(
           g.pending_since + make_interval(secs => coalesce(g.sla_minutes, s.default_sla_minutes) * 60), v_f)
     and not exists (select 1 from public.after_hours_sla_notices n where n.group_id = g.id and n.pending_since = g.pending_since)
   order by g.pending_since;
end;
$$;
revoke all on function public.after_hours_sla_candidates(uuid) from public, anon, authenticated;
grant execute on function public.after_hours_sla_candidates(uuid) to service_role;

notify pgrst, 'reload schema';
