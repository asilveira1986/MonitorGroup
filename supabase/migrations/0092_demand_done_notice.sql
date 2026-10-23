-- =====================================================================
-- Aviso ao cliente quando a demanda é entregue, com observação.
--
--  * demands.delivery_note: observação da entrega, escrita ao marcar
--    "Demanda entregue" (opcional; deliver_demand).
--  * Ao passar para entregue (painel, #entregue no WhatsApp...), o sistema
--    manda no grupo o aviso de conclusão, respondendo a mensagem que
--    originou a demanda. Liga/desliga e texto em Configurações › Tipos de
--    demanda (demand_done_notify / demand_done_template), com {numero}
--    {demanda} {tipo} {responsavel} {entregue_em} {observacao} {grupo}.
-- =====================================================================

alter table public.demands add column if not exists delivery_note text;

alter table public.app_settings
  add column if not exists demand_done_notify boolean not null default true,
  add column if not exists demand_done_template text;

-- "Demanda entregue" com observação: a observação vai junto na mesma gravação da entrega (as
-- regras de quem pode entregar continuam as de update_demand e do guarda dos grupos)
create or replace function public.demands_fill_delivery_note()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'entregue' and old.status is distinct from 'entregue'
     and nullif(current_setting('app.delivery_note', true), '') is not null then
    new.delivery_note := left(current_setting('app.delivery_note', true), 1000);
  end if;
  return new;
end;
$$;
drop trigger if exists demands_delivery_note on public.demands;
create trigger demands_delivery_note before update of status on public.demands
  for each row execute function public.demands_fill_delivery_note();

create or replace function public.deliver_demand(p_id uuid, p_note text default null, p_actor text default null)
returns void
language plpgsql
set search_path = public
as $$
begin
  perform set_config('app.delivery_note', coalesce(btrim(p_note), ''), true);
  perform public.update_demand(p_id, '{"status": "entregue"}'::jsonb, null, p_actor);
  perform set_config('app.delivery_note', '', true);
end;
$$;
revoke all on function public.deliver_demand(uuid, text, text) from public, anon;
grant execute on function public.deliver_demand(uuid, text, text) to authenticated;

-- texto do aviso de conclusão (o da empresa ou o padrão), com as variáveis trocadas
create or replace function public.demand_done_notice(p_demand public.demands)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_tz text;
  v_tpl text;
  v_group text;
  v_person text;
  v_note text := nullif(btrim(coalesce(p_demand.delivery_note, '')), '');
begin
  select coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'), nullif(btrim(s.demand_done_template), '')
    into v_tz, v_tpl
    from public.app_settings s join public.groups g on g.company_id = s.company_id
   where g.id = p_demand.group_id;
  select name into v_group from public.groups where id = p_demand.group_id;
  select name into v_person from public.team_members where id = p_demand.assignee_id;
  v_tpl := coalesce(v_tpl, E'✅ *Demanda concluída* (nº {numero})\n{demanda}\n\n📅 *Entregue em:* {entregue_em}\n👤 *Responsável:* {responsavel}{observacao}');
  return replace(replace(replace(replace(replace(replace(replace(v_tpl,
    '{numero}', coalesce(p_demand.number::text, '')),
    '{demanda}', coalesce(p_demand.description, '')),
    '{tipo}', coalesce(p_demand.type, '')),
    '{responsavel}', coalesce(v_person, 'equipe')),
    '{entregue_em}', to_char(coalesce(p_demand.delivered_at, now()) at time zone v_tz, 'DD/MM/YYYY "às" HH24:MI')),
    '{observacao}', case when v_note is null then '' else E'\n\n📝 *Observação:* ' || v_note end),
    '{grupo}', coalesce(v_group, ''));
end;
$$;
revoke all on function public.demand_done_notice(public.demands) from public, anon;
grant execute on function public.demand_done_notice(public.demands) to authenticated, service_role;

-- ao passar para entregue: põe o aviso na fila de envio do grupo
create or replace function public.demands_notify_done()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_on boolean;
  v_group public.groups%rowtype;
  v_text text;
  v_sender text;
begin
  if new.status <> 'entregue' or old.status = 'entregue' then
    return new;
  end if;
  select * into v_group from public.groups where id = new.group_id;
  if v_group.id is null or v_group.removed_at is not null or not v_group.monitored then
    return new;
  end if;
  select coalesce(demand_done_notify, true) into v_on from public.app_settings where company_id = v_group.company_id;
  if not coalesce(v_on, true) then
    return new;
  end if;
  v_text := public.demand_done_notice(new);
  if nullif(btrim(v_text), '') is null then
    return new;
  end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_sender from public.profiles where id = auth.uid();
  -- o aviso nunca impede a entrega
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
    raise warning 'aviso de conclusão da demanda % não foi para a fila: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists demands_notify_done on public.demands;
create trigger demands_notify_done after update of status on public.demands
  for each row execute function public.demands_notify_done();
