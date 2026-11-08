-- =====================================================================
-- Gatilhos de disparo: arquivo, variações do texto e janela de horário (como nos disparos comuns).
--
--  * broadcast_triggers ganha variants, media_* e window_*. A mensagem pode ficar vazia quando há arquivo.
--  * broadcast_trigger_save: novos parâmetros (variações, arquivo, janela). A assinatura antiga é removida.
--  * broadcast_triggers_run: cada envio criado copia variações, arquivo e janela da regra. Com janela, o
--    envio nasce normalmente e o worker só envia dentro dos dias e horas (o aniversário continua valendo
--    no dia: o que sobra fora da janela espera a janela abrir).
-- =====================================================================

alter table public.broadcast_triggers add column if not exists variants text[] not null default '{}';
alter table public.broadcast_triggers add column if not exists media_path text;
alter table public.broadcast_triggers add column if not exists media_mime text;
alter table public.broadcast_triggers add column if not exists media_name text;
alter table public.broadcast_triggers add column if not exists media_type text;
alter table public.broadcast_triggers add column if not exists window_enabled boolean not null default false;
alter table public.broadcast_triggers add column if not exists window_days int[] not null default '{1,2,3,4,5}';
alter table public.broadcast_triggers add column if not exists window_start text not null default '08:00';
alter table public.broadcast_triggers add column if not exists window_end text not null default '18:00';

do $$
begin
  begin
    alter table public.broadcast_triggers add constraint broadcast_triggers_media_type_check
      check (media_type is null or media_type in ('image', 'video', 'document', 'audio'));
  exception when duplicate_object then null;
  end;
  alter table public.broadcast_triggers drop constraint if exists broadcast_triggers_message_check;
  alter table public.broadcast_triggers add constraint broadcast_triggers_message_check check (length(message) <= 4000);
end $$;

drop function if exists public.broadcast_trigger_save(text, text, uuid, text, text, uuid, text, boolean, boolean);
create or replace function public.broadcast_trigger_save(
  p_name text, p_kind text, p_tag_id uuid, p_send_time text, p_target text, p_instance_id uuid,
  p_message text, p_optout_footer boolean default true, p_include_existing boolean default false,
  p_variants text[] default '{}', p_media jsonb default null, p_window jsonb default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_msg text := coalesce(btrim(coalesce(p_message, '')), '');
  v_target text := case when p_kind = 'birthday' then 'people' else coalesce(p_target, 'people') end;
  v_variants text[] := coalesce(array(select btrim(x) from unnest(coalesce(p_variants, '{}')) x where btrim(x) <> ''), '{}');
  v_media_path text := nullif(p_media->>'path', '');
  v_media_type text := nullif(p_media->>'type', '');
  v_days int[];
  v_start text;
  v_end text;
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
  if v_msg = '' and v_media_path is null then
    raise exception 'Escreva a mensagem ou anexe um arquivo.';
  end if;
  if length(v_msg) > 4000 or exists (select 1 from unnest(v_variants) x where length(x) > 4000) then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  if cardinality(v_variants) > 4 then
    raise exception 'No máximo 4 variações além do texto principal.';
  end if;
  if cardinality(v_variants) > 0 and v_msg = '' then
    raise exception 'Escreva o texto principal para usar variações.';
  end if;
  if v_media_path is not null then
    if v_media_path not like v_company::text || '/%' then
      raise exception 'Arquivo inválido.';
    end if;
    if v_media_type is null or v_media_type not in ('image', 'video', 'document', 'audio') then
      raise exception 'Tipo de arquivo inválido.';
    end if;
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
  if p_window is not null and jsonb_typeof(p_window) = 'object' then
    v_days := coalesce(array(select jsonb_array_elements_text(p_window->'days')::int), '{}');
    v_start := coalesce(p_window->>'start', '08:00');
    v_end := coalesce(p_window->>'end', '18:00');
    if cardinality(v_days) = 0 or exists (select 1 from unnest(v_days) d where d < 0 or d > 6) then
      raise exception 'Escolha os dias da semana do horário de envio.';
    end if;
    if v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_start = v_end then
      raise exception 'Horário de envio inválido.';
    end if;
  end if;

  insert into public.broadcast_triggers (company_id, name, kind, target, tag_id, send_time, instance_id, message, optout_footer, created_by,
                                         variants, media_path, media_mime, media_name, media_type,
                                         window_enabled, window_days, window_start, window_end)
  values (v_company, v_name, p_kind, v_target, case when p_kind = 'tag_applied' then p_tag_id end,
          coalesce(nullif(p_send_time, ''), '09:00'), case when v_target = 'people' then p_instance_id end,
          v_msg, coalesce(p_optout_footer, true) and v_target = 'people', auth.uid(),
          v_variants, v_media_path, nullif(p_media->>'mime', ''), nullif(p_media->>'name', ''), v_media_type,
          v_days is not null, coalesce(v_days, '{1,2,3,4,5}'), coalesce(v_start, '08:00'), coalesce(v_end, '18:00'))
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
revoke all on function public.broadcast_trigger_save(text, text, uuid, text, text, uuid, text, boolean, boolean, text[], jsonb, jsonb) from public, anon;
grant execute on function public.broadcast_trigger_save(text, text, uuid, text, text, uuid, text, boolean, boolean, text[], jsonb, jsonb) to authenticated;

-- ------------------------------------------------ o worker cria os envios dos gatilhos (agora com o conteúdo completo)
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
                                              optout_footer, trigger_id, variants, media_path, media_mime, media_name, media_type,
                                              window_enabled, window_days, window_start, window_end)
      values (t.company_id, t.name || ' · ' || to_char(v_local, 'DD/MM/YYYY HH24:MI'), t.target,
              jsonb_build_object('target', t.target, 'trigger', t.kind), t.instance_id, t.message, 'scheduled', now(), t.created_by,
              t.optout_footer, t.id, t.variants, t.media_path, t.media_mime, t.media_name, t.media_type,
              t.window_enabled, t.window_days, t.window_start, t.window_end)
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
