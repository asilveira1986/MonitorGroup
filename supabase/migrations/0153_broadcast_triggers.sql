-- =====================================================================
-- Disparos, fase 4: gatilhos por evento (etiqueta aplicada e aniversário).
--
--  * contacts.birthday: aniversário do contato (campo novo no cadastro de Contatos).
--  * broadcast_triggers: a regra (tipo, etiqueta ou horário, mensagem, número que envia, rodapé "SAIR").
--  * broadcast_trigger_log: quem já recebeu por cada regra (etiqueta: uma vez só; aniversário: uma vez por ano).
--  * broadcast_triggers_run(): chamada pelo worker de minuto em minuto. Cria um envio (campanha filha, com
--    trigger_id) para quem entrou na regra desde a última vez. Não precisa de gancho nas etiquetas: compara
--    quem tem a etiqueta agora com quem já está no registro.
--  * Etiqueta aplicada: por padrão quem já tinha a etiqueta na hora de criar a regra NÃO recebe
--    (include_existing = false grava essas pessoas como "já vistas").
--  * Aniversário: no dia, a partir do horário escolhido, no fuso da empresa (29/02 vale 28/02 em ano comum).
--    Se o worker ficou parado, envia assim que voltar, no mesmo dia.
--  * Excluir a etiqueta da regra apaga a regra. Quem fez opt-out nunca recebe.
-- =====================================================================

alter table public.contacts add column if not exists birthday date;

create or replace function public.set_contact_birthday(p_id uuid, p_birthday date)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_private_chats() then
    raise exception 'Os contatos não estão liberados para você nesta empresa.' using errcode = '42501';
  end if;
  if p_birthday is not null and (p_birthday > current_date or p_birthday < date '1900-01-01') then
    raise exception 'Data de aniversário inválida.';
  end if;
  update public.contacts set birthday = p_birthday, updated_at = now() where id = p_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Contato não encontrado.';
  end if;
end;
$$;
revoke all on function public.set_contact_birthday(uuid, date) from public, anon;
grant execute on function public.set_contact_birthday(uuid, date) to authenticated;

-- ------------------------------------------------ regras
create table if not exists public.broadcast_triggers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name          text not null check (length(btrim(name)) between 1 and 120),
  kind          text not null check (kind in ('tag_applied', 'birthday')),
  target        text not null default 'people' check (target in ('groups', 'people')),
  tag_id        uuid references public.customer_tags(id) on delete cascade,
  send_time     text not null default '09:00',
  instance_id   uuid references public.whatsapp_instances(id) on delete set null,
  message       text not null check (length(btrim(message)) between 1 and 4000),
  optout_footer boolean not null default true,
  enabled       boolean not null default true,
  last_run_at   timestamptz,
  last_run_note text,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists broadcast_triggers_company_idx on public.broadcast_triggers (company_id, created_at desc);

create table if not exists public.broadcast_trigger_log (
  trigger_id uuid not null references public.broadcast_triggers(id) on delete cascade,
  key        text not null,
  period     text not null default '',
  fired_at   timestamptz not null default now(),
  sent       boolean not null default true,
  primary key (trigger_id, key, period)
);

alter table public.broadcast_campaigns add column if not exists trigger_id uuid references public.broadcast_triggers(id) on delete set null;

alter table public.broadcast_triggers enable row level security;
alter table public.broadcast_trigger_log enable row level security;
drop policy if exists broadcast_triggers_read on public.broadcast_triggers;
create policy broadcast_triggers_read on public.broadcast_triggers for select
  using ((select public.can_use_broadcasts()) and company_id = (select public.current_company_id()));
revoke all on public.broadcast_triggers, public.broadcast_trigger_log from anon;
grant select on public.broadcast_triggers to authenticated;
grant select, insert, update, delete on public.broadcast_triggers, public.broadcast_trigger_log to service_role;

-- criar a regra (p_include_existing: etiqueta aplicada também para quem já tem a etiqueta agora)
create or replace function public.broadcast_trigger_save(
  p_name text, p_kind text, p_tag_id uuid, p_send_time text, p_target text, p_instance_id uuid,
  p_message text, p_optout_footer boolean default true, p_include_existing boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_msg text := nullif(btrim(coalesce(p_message, '')), '');
  v_target text := case when p_kind = 'birthday' then 'people' else coalesce(p_target, 'people') end;
  v_id uuid;
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Dê um nome ao gatilho.';
  end if;
  if p_kind not in ('tag_applied', 'birthday') then
    raise exception 'Escolha o gatilho: etiqueta aplicada ou aniversário.';
  end if;
  if v_target not in ('groups', 'people') then
    raise exception 'Escolha para quem enviar: grupos ou pessoas.';
  end if;
  if v_msg is null then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_msg) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  if p_kind = 'tag_applied' and not exists (select 1 from public.customer_tags t where t.id = p_tag_id and t.company_id = v_company) then
    raise exception 'Escolha a etiqueta que dispara a mensagem.';
  end if;
  if p_kind = 'birthday' and coalesce(p_send_time, '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'Horário de envio inválido.';
  end if;
  if v_target = 'people' and (p_instance_id is null or not exists (select 1 from public.whatsapp_instances i where i.id = p_instance_id and i.company_id = v_company)) then
    raise exception 'Escolha o número do WhatsApp que envia.';
  end if;

  insert into public.broadcast_triggers (company_id, name, kind, target, tag_id, send_time, instance_id, message, optout_footer, created_by)
  values (v_company, v_name, p_kind, v_target, case when p_kind = 'tag_applied' then p_tag_id end,
          coalesce(nullif(p_send_time, ''), '09:00'), case when v_target = 'people' then p_instance_id end,
          v_msg, coalesce(p_optout_footer, true) and v_target = 'people', auth.uid())
  returning id into v_id;

  -- quem já tem a etiqueta agora fica como "já visto" (a menos que o usuário peça para enviar a eles também)
  if p_kind = 'tag_applied' and not coalesce(p_include_existing, false) then
    insert into public.broadcast_trigger_log (trigger_id, key, period, sent)
    select v_id, coalesce(a.group_id::text, public.phone_key(a.phone)), '', false
      from public.broadcast_audience_for(v_company, jsonb_build_object('target', v_target, 'tag_ids', jsonb_build_array(p_tag_id))) a
    on conflict do nothing;
  end if;

  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary)
  select v_company, p.id, p.email, p.full_name, 'atendimento', 'criou', 'broadcast_triggers', v_id::text,
         'Criou o gatilho de disparo "' || v_name || '"'
    from public.profiles p where p.id = auth.uid();
  return v_id;
end;
$$;
revoke all on function public.broadcast_trigger_save(text, text, uuid, text, text, uuid, text, boolean, boolean) from public, anon;
grant execute on function public.broadcast_trigger_save(text, text, uuid, text, text, uuid, text, boolean, boolean) to authenticated;

create or replace function public.broadcast_trigger_set_enabled(p_id uuid, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  update public.broadcast_triggers set enabled = p_enabled where id = p_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Gatilho não encontrado.';
  end if;
end;
$$;
revoke all on function public.broadcast_trigger_set_enabled(uuid, boolean) from public, anon;
grant execute on function public.broadcast_trigger_set_enabled(uuid, boolean) to authenticated;

create or replace function public.broadcast_trigger_delete(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_broadcasts() then
    raise exception 'Os disparos estão liberados só para quem administra a plataforma.' using errcode = '42501';
  end if;
  delete from public.broadcast_triggers where id = p_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Gatilho não encontrado.';
  end if;
end;
$$;
revoke all on function public.broadcast_trigger_delete(uuid) from public, anon;
grant execute on function public.broadcast_trigger_delete(uuid) to authenticated;

-- ------------------------------------------------ o worker cria os envios dos gatilhos
create or replace function public.broadcast_triggers_run()
returns int language plpgsql security definer set search_path = public as $$
declare
  t public.broadcast_triggers;
  v_tz text;
  v_local timestamp;
  v_today date;
  v_year int;
  v_leap boolean;
  v_child uuid;
  v_n int;
  v_made int := 0;
  v_note text;
begin
  for t in
    select * from public.broadcast_triggers where enabled order by created_at for update skip locked
  loop
    select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = t.company_id;
    v_tz := coalesce(v_tz, 'America/Sao_Paulo');
    v_local := now() at time zone v_tz;
    v_today := v_local::date;
    v_year := extract(year from v_today)::int;
    v_leap := (v_year % 4 = 0 and (v_year % 100 <> 0 or v_year % 400 = 0));
    v_note := null;

    v_child := null;
    v_n := 0;
    -- o envio nasce já com os destinatários desta rodada; sem ninguém, é apagado
    if t.kind = 'tag_applied' or (t.kind = 'birthday' and v_local::time >= t.send_time::time) then
      insert into public.broadcast_campaigns (company_id, name, target, audience, instance_id, message, status, scheduled_at, created_by,
                                              optout_footer, trigger_id)
      values (t.company_id, t.name || ' · ' || to_char(v_local, 'DD/MM/YYYY HH24:MI'), t.target,
              jsonb_build_object('target', t.target, 'trigger', t.kind), t.instance_id, t.message, 'scheduled', now(), t.created_by,
              t.optout_footer, t.id)
      returning id into v_child;

      if t.kind = 'tag_applied' then
        insert into public.broadcast_recipients (campaign_id, company_id, kind, group_id, name, phone, jid, instance_id)
        select v_child, t.company_id, a.kind, a.group_id, a.name, a.phone, a.jid,
               case when t.target = 'people' then t.instance_id else a.instance_id end
          from public.broadcast_audience_for(t.company_id, jsonb_build_object('target', t.target, 'tag_ids', jsonb_build_array(t.tag_id))) a
         where not exists (select 1 from public.broadcast_trigger_log l
                            where l.trigger_id = t.id and l.key = coalesce(a.group_id::text, public.phone_key(a.phone)) and l.period = '')
         on conflict do nothing;
      else
        insert into public.broadcast_recipients (campaign_id, company_id, kind, name, phone, instance_id)
        select v_child, t.company_id, 'person', c.name, public.br_phone(c.phone), t.instance_id
          from public.contacts c
         where c.company_id = t.company_id and c.birthday is not null and public.br_phone(c.phone) is not null
           and ((extract(month from c.birthday) = extract(month from v_today) and extract(day from c.birthday) = extract(day from v_today))
                or (not v_leap and extract(month from v_today) = 2 and extract(day from v_today) = 28
                    and extract(month from c.birthday) = 2 and extract(day from c.birthday) = 29))
           and not exists (select 1 from public.broadcast_trigger_log l
                            where l.trigger_id = t.id and l.key = public.phone_key(public.br_phone(c.phone)) and l.period = v_year::text)
           and not exists (select 1 from public.broadcast_optouts o
                            where o.company_id = t.company_id and public.phone_key(o.phone) = public.phone_key(public.br_phone(c.phone)))
         on conflict do nothing;
      end if;
      get diagnostics v_n = row_count;

      if v_n = 0 then
        delete from public.broadcast_campaigns where id = v_child;
      elsif v_n > 5000 then
        delete from public.broadcast_campaigns where id = v_child;
        v_note := 'Pulado: mais de 5000 destinatários de uma vez (' || v_n || ').';
      else
        insert into public.broadcast_trigger_log (trigger_id, key, period)
        select t.id, coalesce(r.group_id::text, public.phone_key(r.phone)), case when t.kind = 'birthday' then v_year::text else '' end
          from public.broadcast_recipients r where r.campaign_id = v_child
        on conflict do nothing;
        v_made := v_made + 1;
        v_note := 'Enviado para ' || v_n || ' destinatário(s).';
      end if;
    end if;

    if v_note is not null then
      update public.broadcast_triggers set last_run_at = now(), last_run_note = v_note where id = t.id;
    end if;
  end loop;
  return v_made;
end;
$$;
revoke all on function public.broadcast_triggers_run() from public, anon, authenticated;
grant execute on function public.broadcast_triggers_run() to service_role;

notify pgrst, 'reload schema';
