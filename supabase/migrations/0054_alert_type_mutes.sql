-- =====================================================================
-- Silenciar alertas por tipo.
--
-- Para os AVISOS de um tipo de alerta na empresa toda, por um tempo
-- (1 h, 8 h, 24 h, 7 dias) ou sempre:
--   * 'message'  = nova mensagem de cliente (aviso em tela, voz e som);
--   * 'sla'      = SLA excedido (aviso em tela e voz);
--   * os tipos das regras de alerta (no_response, keyword, ...): aviso em
--     tela, voz e o aviso por WhatsApp, e-mail e webhook.
-- O monitoramento não para: mensagens, pendências, tempos e a lista da
-- tela Alertas seguem normais.
--
-- Quem pode: administrador da empresa, quem administra a plataforma e as
-- pessoas dos setores com "Silenciar alertas" (Configurações › Setores).
-- =====================================================================

alter table public.sectors
  add column if not exists can_mute_alerts boolean not null default false;

create table if not exists public.alert_type_mutes (
  company_id    uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  type          text not null,
  muted_until   timestamptz not null,          -- 'infinity' = sempre
  muted_by      uuid,
  muted_by_name text,
  created_at    timestamptz not null default now(),
  primary key (company_id, type)
);

alter table public.alert_type_mutes enable row level security;
drop policy if exists alert_type_mutes_read on public.alert_type_mutes;
create policy alert_type_mutes_read on public.alert_type_mutes for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
grant select on public.alert_type_mutes to authenticated;

-- pode silenciar alertas na empresa atual?
create or replace function public.can_mute_alerts()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user() and (
    public.is_platform_admin() or public.is_admin()
    or (public.can_write() and exists (
      select 1 from public.sectors s
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
      where s.company_id = public.current_company_id() and s.can_mute_alerts))
  )
$$;
revoke all on function public.can_mute_alerts() from public, anon;
grant execute on function public.can_mute_alerts() to authenticated;

-- silenciar / reativar um tipo de alerta (p_until null = reativar)
create or replace function public.set_alert_type_mute(p_type text, p_until timestamptz)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_name    text;
  v_off     boolean := p_until is null or p_until <= now();
begin
  if not public.can_mute_alerts() then
    raise exception 'Você não tem permissão para silenciar alertas.' using errcode = '42501';
  end if;
  if p_type is null or p_type !~ '^[a-z_]{2,40}$' then
    raise exception 'Tipo de alerta inválido.';
  end if;
  if v_off then
    delete from public.alert_type_mutes where company_id = v_company and type = p_type;
  else
    select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
    insert into public.alert_type_mutes (company_id, type, muted_until, muted_by, muted_by_name)
    values (v_company, p_type, p_until, auth.uid(), v_name)
    on conflict (company_id, type) do update
      set muted_until = excluded.muted_until, muted_by = excluded.muted_by,
          muted_by_name = excluded.muted_by_name, created_at = now();
  end if;
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary)
  select v_company, p.id, p.email, coalesce(nullif(p.full_name, ''), p.email), 'alertas',
         case when v_off then 'reativou' else 'silenciou' end, 'alert_type_mutes', p_type,
         case when v_off then 'Reativou os avisos de alerta: ' else 'Silenciou os avisos de alerta: ' end || case p_type
           when 'message' then 'Nova mensagem de cliente' when 'sla' then 'SLA excedido'
           when 'no_response' then 'Cliente sem resposta' when 'keyword' then 'Palavra-chave'
           when 'high_volume' then 'Volume alto' when 'disconnected' then 'WhatsApp desconectado'
           when 'inactivity' then 'Grupo sem movimentação' when 'deadline_missed' then 'Prazo prometido vencido'
           when 'rework' then 'Retrabalho' when 'recurrence' then 'Reincidência sem resposta'
           else p_type end
         || case when v_off then ''
                 when p_until = 'infinity' then ' (sempre)'
                 else ' até ' || to_char(p_until at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') end
  from public.profiles p where p.id = auth.uid();
end;
$$;
revoke all on function public.set_alert_type_mute(text, timestamptz) from public, anon;
grant execute on function public.set_alert_type_mute(text, timestamptz) to authenticated;
