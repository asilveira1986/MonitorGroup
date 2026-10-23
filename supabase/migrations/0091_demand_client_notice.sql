-- =====================================================================
-- Aviso ao cliente ao registrar uma demanda.
--
-- Quando uma demanda é registrada (pelo painel, por comando, palavra-chave,
-- compromisso ou IA), o sistema manda no grupo, pelo número conectado, a
-- demanda e a data de entrega, respondendo a mensagem que a originou.
-- Liga/desliga e o texto ficam em Configurações › Tipos de demanda
-- (app_settings.demand_notify_client / demand_notify_template), com as
-- variáveis {numero} {demanda} {tipo} {responsavel} {prazo} {grupo}.
-- =====================================================================

alter table public.app_settings
  add column if not exists demand_notify_client boolean not null default true,
  add column if not exists demand_notify_template text;

-- texto do aviso (o da empresa ou o padrão), já com as variáveis trocadas
create or replace function public.demand_client_notice(p_demand public.demands)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_tz text;
  v_tpl text;
  v_group text;
  v_person text;
  v_due text;
begin
  select coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'), nullif(btrim(s.demand_notify_template), '')
    into v_tz, v_tpl
    from public.app_settings s join public.groups g on g.company_id = s.company_id
   where g.id = p_demand.group_id;
  select name into v_group from public.groups where id = p_demand.group_id;
  select name into v_person from public.team_members where id = p_demand.assignee_id;
  v_due := case
    when p_demand.promised_at is null then 'a definir'
    when to_char(p_demand.promised_at at time zone v_tz, 'HH24:MI') in ('00:00', '23:59')
      then to_char(p_demand.promised_at at time zone v_tz, 'DD/MM/YYYY')
    else to_char(p_demand.promised_at at time zone v_tz, 'DD/MM/YYYY "às" HH24:MI')
  end;
  v_tpl := coalesce(v_tpl,
    E'📋 *Demanda registrada* (nº {numero})\n{demanda}\n\n📅 *Previsão de entrega:* {prazo}\n👤 *Responsável:* {responsavel}');
  return replace(replace(replace(replace(replace(replace(v_tpl,
    '{numero}', coalesce(p_demand.number::text, '')),
    '{demanda}', coalesce(p_demand.description, '')),
    '{tipo}', coalesce(p_demand.type, '')),
    '{responsavel}', coalesce(v_person, 'equipe')),
    '{prazo}', v_due),
    '{grupo}', coalesce(v_group, ''));
end;
$$;
revoke all on function public.demand_client_notice(public.demands) from public, anon;
grant execute on function public.demand_client_notice(public.demands) to authenticated, service_role;

-- ao registrar: põe o aviso na fila de envio do grupo (o worker manda pelo número conectado)
create or replace function public.demands_notify_client()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_on boolean;
  v_group public.groups%rowtype;
  v_text text;
  v_sender text;
begin
  select * into v_group from public.groups where id = new.group_id;
  if v_group.id is null or v_group.removed_at is not null or not v_group.monitored then
    return new;
  end if;
  select coalesce(demand_notify_client, true) into v_on from public.app_settings where company_id = v_group.company_id;
  if not coalesce(v_on, true) then
    return new;
  end if;
  v_text := public.demand_client_notice(new);
  if nullif(btrim(v_text), '') is null then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_sender from public.profiles where id = auth.uid();
  -- o aviso nunca impede registrar a demanda (ex.: quem registrou não pode responder no grupo)
  begin
    perform set_config('app.activity_skip', 'on', true);
    insert into public.outgoing_messages
      (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by)
    values
      (v_group.id, v_group.instance_id, v_text, v_text,
       (select id from public.messages where id = new.origin_message_id and group_id = v_group.id),
       coalesce(v_sender, 'Demandas'), auth.uid());
    perform set_config('app.activity_skip', 'off', true);
  exception when others then
    perform set_config('app.activity_skip', 'off', true);
    raise warning 'aviso da demanda % não foi para a fila: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists demands_notify_client on public.demands;
create trigger demands_notify_client after insert on public.demands
  for each row execute function public.demands_notify_client();
