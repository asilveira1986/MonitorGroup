-- =====================================================================
-- LGPD: prazo de guarda das mensagens e pedidos dos titulares.
--
-- 1) Prazo de guarda (app_settings.message_retention_months; vazio = sem
--    prazo): passado o prazo, o worker apaga o conteúdo e o remetente das
--    mensagens (texto, nome, telefone, arquivo, citação) nos grupos e no
--    privado, e as reações/confirmações de leitura. Fica só o registro de
--    que houve a mensagem (data, cliente ou equipe), para os indicadores e o
--    histórico de atendimento não mudarem (anonymized_at marca o que saiu).
-- 2) Pedidos do titular (Configurações › LGPD, só administradores): pelo
--    telefone, ver os dados da pessoa, exportar (arquivo JSON) e apagar.
--    Cada consulta, exportação e exclusão fica no log de atividades.
-- =====================================================================

alter table public.app_settings add column if not exists message_retention_months int
  check (message_retention_months is null or message_retention_months between 1 and 120);
alter table public.messages add column if not exists anonymized_at timestamptz;
alter table public.private_messages add column if not exists anonymized_at timestamptz;
-- para achar rápido o que ainda não saiu pelo prazo
create index if not exists messages_retention_idx on public.messages (sent_at) where anonymized_at is null;
create index if not exists private_messages_retention_idx on public.private_messages (sent_at) where anonymized_at is null;

-- ---------------------------------------------------------------------
-- 1) prazo de guarda (worker, chave de serviço): um lote por chamada; devolve os
--    arquivos a apagar do Storage e quantas mensagens saíram
-- ---------------------------------------------------------------------
create or replace function public.apply_message_retention(p_company_id uuid, p_limit int default 2000)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_months int;
  v_cutoff timestamptz;
  v_paths text[] := '{}';
  v_part text[];
  v_groups int := 0;
  v_private int := 0;
begin
  select message_retention_months into v_months from public.app_settings where company_id = p_company_id;
  if v_months is null then
    return jsonb_build_object('mensagens', 0, 'privadas', 0, 'arquivos', '[]'::jsonb);
  end if;
  v_cutoff := now() - make_interval(months => v_months);
  perform set_config('app.activity_skip', 'on', true);

  with alvo as (
    select m.id, m.media_path as old_path from public.messages m join public.groups g on g.id = m.group_id
     where g.company_id = p_company_id and m.sent_at < v_cutoff and m.anonymized_at is null
     order by m.sent_at limit p_limit
  ), u as (
    update public.messages m
       set body = null, original_body = null, sender_name = null, sender_phone = null, sender_jid = null,
           quoted_body = null, quoted_sender_jid = null,
           media_path = null, media_status = case when m.media_path is not null then 'expired' else m.media_status end,
           anonymized_at = now()
      from alvo
     where m.id = alvo.id
    returning alvo.old_path
  )
  select count(*), coalesce(array_agg(old_path) filter (where old_path is not null), '{}') into v_groups, v_part from u;
  v_paths := v_paths || v_part;
  delete from public.message_reactions r using public.messages m
   where r.message_id = m.id and m.anonymized_at is not null and r.company_id = p_company_id;
  delete from public.message_receipts r using public.messages m
   where r.message_id = m.id and m.anonymized_at is not null and r.company_id = p_company_id;

  with alvo as (
    select pm.id, pm.media_path as old_path from public.private_messages pm
     where pm.company_id = p_company_id and pm.sent_at < v_cutoff and pm.anonymized_at is null
     order by pm.sent_at limit p_limit
  ), u as (
    update public.private_messages pm
       set body = null, original_body = null, sender_name = null,
           media_path = null, media_status = case when pm.media_path is not null then 'expired' else pm.media_status end,
           anonymized_at = now()
      from alvo
     where pm.id = alvo.id
    returning alvo.old_path
  )
  select count(*), coalesce(array_agg(old_path) filter (where old_path is not null), '{}') into v_private, v_part from u;
  v_paths := v_paths || v_part;
  delete from public.private_reactions r using public.private_messages pm
   where r.message_id = pm.id and pm.anonymized_at is not null and r.company_id = p_company_id;

  perform set_config('app.activity_skip', 'off', true);
  return jsonb_build_object('mensagens', v_groups, 'privadas', v_private, 'arquivos', to_jsonb(v_paths));
end;
$$;
revoke all on function public.apply_message_retention(uuid, int) from public, anon, authenticated;
grant execute on function public.apply_message_retention(uuid, int) to service_role;

-- ---------------------------------------------------------------------
-- 2) pedidos do titular
-- ---------------------------------------------------------------------

-- identificadores da pessoa na empresa atual: o número (com e sem o 9) e os LIDs conhecidos
create or replace function public.lgpd_person_jids(p_phone text)
returns text[]
language sql stable security definer set search_path = public
as $$
  with k as (select public.phone_key(p_phone) as key),
  ids as (
    select gp.jid as id from public.group_participants gp, k
     where gp.company_id = public.current_company_id() and public.phone_key(gp.phone) = k.key
    union select gp.lid from public.group_participants gp, k
     where gp.company_id = public.current_company_id() and gp.lid is not null and public.phone_key(gp.phone) = k.key
    union select w.jid from public.wa_contacts w, k
     where w.company_id = public.current_company_id() and public.phone_key(w.phone) = k.key
    union select w.lid from public.wa_contacts w, k
     where w.company_id = public.current_company_id() and w.lid is not null and public.phone_key(w.phone) = k.key
    union select c.jid from public.private_chats c, k
     where c.company_id = public.current_company_id() and public.phone_key(c.phone) = k.key
    union select d || '@s.whatsapp.net' from k,
           lateral (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x where length(d) >= 10
  )
  select coalesce(array_agg(distinct id) filter (where id is not null), '{}') from ids
$$;
revoke all on function public.lgpd_person_jids(text) from public, anon, authenticated;
grant execute on function public.lgpd_person_jids(text) to service_role;

create or replace function public.lgpd_check_admin(p_phone text)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if not (public.is_admin() or public.is_platform_admin()) then
    raise exception 'Só administradores atendem pedidos de dados pessoais (LGPD).' using errcode = '42501';
  end if;
  if length(v_digits) between 10 and 11 then
    v_digits := '55' || v_digits;  -- DDD + número: Brasil
  end if;
  if length(v_digits) < 12 or length(v_digits) > 15 then
    raise exception 'Informe o telefone com DDD (e o código do país, se não for do Brasil).';
  end if;
  return v_digits;
end;
$$;
revoke all on function public.lgpd_check_admin(text) from public, anon, authenticated;

-- registra no log (telefone mascarado)
create or replace function public.lgpd_log(p_action text, p_phone text, p_details jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, summary, details)
  select public.current_company_id(), p.id, p.email, coalesce(nullif(p.full_name, ''), p.email), 'lgpd', p_action, 'titular',
         'LGPD: ' || p_action || ' dados do telefone ***' || right(regexp_replace(p_phone, '\D', '', 'g'), 4), p_details
    from public.profiles p where p.id = auth.uid()
$$;
revoke all on function public.lgpd_log(text, text, jsonb) from public, anon, authenticated;

-- o que existe da pessoa (contagens)
create or replace function public.lgpd_person_summary(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits text := public.lgpd_check_admin(p_phone);
  v_jids text[] := public.lgpd_person_jids(v_digits);
  v_key text := public.phone_key(v_digits);
  v_company uuid := public.current_company_id();
  v_res jsonb;
begin
  select jsonb_build_object(
    'telefone', v_digits,
    'identificadores', to_jsonb(v_jids),
    'nomes', coalesce((select jsonb_agg(distinct n) from (
        select nullif(gp.name, '') n from public.group_participants gp where gp.company_id = v_company and gp.jid = any(v_jids)
        union select w.name from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids)
        union select w.notify from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids)
        union select c.name from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids)) x where n is not null), '[]'),
    'mensagens_grupos', (select count(*) from public.messages m join public.groups g on g.id = m.group_id
        where g.company_id = v_company and m.anonymized_at is null and not m.from_me
          and (m.sender_jid = any(v_jids) or public.phone_key(m.sender_phone) = v_key)),
    'grupos', (select count(distinct gp.group_id) from public.group_participants gp where gp.company_id = v_company and gp.jid = any(v_jids)),
    'conversas_privadas', (select count(*) from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids)),
    'mensagens_privadas', (select count(*) from public.private_messages pm join public.private_chats c on c.id = pm.chat_id
        where c.company_id = v_company and c.jid = any(v_jids) and pm.anonymized_at is null),
    'contatos', (select count(*) from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids)),
    'reacoes', (select count(*) from public.message_reactions r where r.company_id = v_company and r.reactor_jid = any(v_jids)),
    'atendente', exists (select 1 from public.team_members t where t.company_id = v_company and public.phone_key(t.phone) = v_key)
  ) into v_res;
  perform public.lgpd_log('consultou', v_digits, v_res - 'identificadores' - 'nomes');
  return v_res;
end;
$$;
revoke all on function public.lgpd_person_summary(text) from public, anon;
grant execute on function public.lgpd_person_summary(text) to authenticated;

-- todos os dados da pessoa (para entregar ao titular)
create or replace function public.lgpd_person_export(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits text := public.lgpd_check_admin(p_phone);
  v_jids text[] := public.lgpd_person_jids(v_digits);
  v_key text := public.phone_key(v_digits);
  v_company uuid := public.current_company_id();
  v_res jsonb;
begin
  select jsonb_build_object(
    'gerado_em', now(),
    'empresa', (select name from public.companies where id = v_company),
    'telefone', v_digits,
    'identificadores', to_jsonb(v_jids),
    'participacao_em_grupos', coalesce((select jsonb_agg(jsonb_build_object(
        'grupo', g.name, 'nome', gp.name, 'telefone', gp.phone, 'papel', gp.role, 'entrou_em', gp.joined_at, 'saiu_em', gp.left_at))
        from public.group_participants gp join public.groups g on g.id = gp.group_id
       where gp.company_id = v_company and gp.jid = any(v_jids)), '[]'),
    'contato_no_whatsapp', coalesce((select jsonb_agg(jsonb_build_object('nome_salvo', w.name, 'nome_whatsapp', w.notify, 'telefone', w.phone))
        from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids)), '[]'),
    'mensagens_em_grupos', coalesce((select jsonb_agg(jsonb_build_object(
        'grupo', g.name, 'enviada_em', m.sent_at, 'nome', m.sender_name, 'tipo', m.message_type, 'texto', m.body) order by m.sent_at)
        from public.messages m join public.groups g on g.id = m.group_id
       where g.company_id = v_company and m.anonymized_at is null and not m.from_me
         and (m.sender_jid = any(v_jids) or public.phone_key(m.sender_phone) = v_key)), '[]'),
    'conversas_privadas', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', c.name, 'telefone', c.phone,
        'mensagens', coalesce((select jsonb_agg(jsonb_build_object(
            'enviada_em', pm.sent_at, 'de', case when pm.from_me then 'empresa' else 'titular' end,
            'tipo', pm.message_type, 'texto', pm.body) order by pm.sent_at)
          from public.private_messages pm where pm.chat_id = c.id and pm.anonymized_at is null), '[]')))
        from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids)), '[]'),
    'reacoes', coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'em', r.reacted_at))
        from public.message_reactions r where r.company_id = v_company and r.reactor_jid = any(v_jids)), '[]')
  ) into v_res;
  perform public.lgpd_log('exportou', v_digits, jsonb_build_object(
    'mensagens', jsonb_array_length(v_res->'mensagens_em_grupos'), 'conversas', jsonb_array_length(v_res->'conversas_privadas')));
  return v_res;
end;
$$;
revoke all on function public.lgpd_person_export(text) from public, anon;
grant execute on function public.lgpd_person_export(text) to authenticated;

-- apaga os dados da pessoa: o conteúdo e o remetente das mensagens dela nos grupos (fica o registro
-- de que houve a mensagem), a conversa privada inteira, o contato, as reações, a foto e a lista de
-- membros. Devolve os arquivos a apagar do Storage (o painel apaga).
create or replace function public.lgpd_person_erase(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits text := public.lgpd_check_admin(p_phone);
  v_jids text[] := public.lgpd_person_jids(v_digits);
  v_key text := public.phone_key(v_digits);
  v_company uuid := public.current_company_id();
  v_paths text[] := '{}';
  v_part text[];
  v_msgs int := 0;
  v_chats int := 0;
  v_other int;
  v_res jsonb;
begin
  if exists (select 1 from public.team_members t where t.company_id = v_company and public.phone_key(t.phone) = v_key) then
    raise exception 'Este telefone é de um atendente: remova-o da equipe antes (Configurações › Atendentes).';
  end if;
  perform set_config('app.activity_skip', 'on', true);

  -- mensagens dela nos grupos: sai o conteúdo e quem mandou
  with alvo as (
    select m.id, m.media_path as old_path from public.messages m join public.groups g on g.id = m.group_id
     where g.company_id = v_company and not m.from_me
       and (m.sender_jid = any(v_jids) or public.phone_key(m.sender_phone) = v_key)
  ), u as (
    update public.messages m
       set body = null, original_body = null, sender_name = null, sender_phone = null, sender_jid = null,
           quoted_body = null, quoted_sender_jid = null,
           media_path = null, media_status = case when m.media_path is not null then 'expired' else m.media_status end,
           anonymized_at = now()
      from alvo
     where m.id = alvo.id
    returning alvo.old_path
  )
  select count(*), coalesce(array_agg(old_path) filter (where old_path is not null), '{}') into v_msgs, v_part from u;
  v_paths := v_paths || v_part;
  -- citações dela em respostas de outros
  update public.messages m set quoted_body = null, quoted_sender_jid = null
    from public.groups g where g.id = m.group_id and g.company_id = v_company and m.quoted_sender_jid = any(v_jids);

  -- conversas privadas (com as mensagens, reações e envios)
  select coalesce(array_agg(pm.media_path) filter (where pm.media_path is not null), '{}') into v_part
    from public.private_messages pm join public.private_chats c on c.id = pm.chat_id
   where c.company_id = v_company and c.jid = any(v_jids);
  v_paths := v_paths || v_part;
  delete from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids);
  get diagnostics v_chats = row_count;

  delete from public.message_reactions r where r.company_id = v_company and r.reactor_jid = any(v_jids);
  delete from public.message_receipts r where r.company_id = v_company and r.user_jid = any(v_jids);
  delete from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids);
  select coalesce(array_agg(a.path) filter (where a.path is not null), '{}') into v_part
    from public.contact_avatars a where a.company_id = v_company and a.jid = any(v_jids);
  v_paths := v_paths || v_part;
  delete from public.contact_avatars a where a.company_id = v_company and a.jid = any(v_jids);
  -- membros: sai nome e telefone (a pessoa segue no grupo do WhatsApp; o worker volta a listá-la se
  -- continuar lá)
  delete from public.group_participants gp where gp.company_id = v_company and gp.jid = any(v_jids);
  get diagnostics v_other = row_count;

  perform set_config('app.activity_skip', 'off', true);
  v_res := jsonb_build_object('mensagens_grupos', v_msgs, 'conversas_privadas', v_chats, 'participacoes', v_other,
                              'arquivos', to_jsonb(v_paths));
  perform public.lgpd_log('apagou', v_digits, v_res - 'arquivos');
  return v_res;
end;
$$;
revoke all on function public.lgpd_person_erase(text) from public, anon;
grant execute on function public.lgpd_person_erase(text) to authenticated;
