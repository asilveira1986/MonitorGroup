-- =====================================================================
-- Cópias do mesmo grupo em números diferentes: mantém as conversas iguais.
--
-- O mesmo grupo do WhatsApp aparece uma vez por número conectado que
-- participa dele (ex.: Cível e Trabalhista). Se um dos números deixa de
-- receber o grupo (desconectado, chave do grupo desatualizada), a cópia dele
-- fica parada enquanto a outra recebe tudo.
--
--  * sync_group_copies_core: copia para a cópia do grupo as mensagens que as
--    outras cópias têm e ela não (mesmo id do WhatsApp), desde uma data, e
--    recalcula a situação (pendência, última mensagem, tempos de resposta).
--    Mensagem "enviada pelo número" na outra cópia entra como da equipe.
--  * sync_group_copies(grupo, dias): botão do administrador (até 30 dias).
--  * sync_all_group_copies(horas): o worker roda de minuto em minuto (e 30
--    dias ao iniciar), em todos os grupos com mais de uma cópia.
-- Mensagens copiadas não disparam aviso de "mensagem nova" nem automação: o
-- número que recebeu já tratou; a cópia fica com a conversa e a pendência.
-- =====================================================================

create or replace function public.sync_group_copies_core(p_group_id uuid, p_since timestamptz)
returns int language plpgsql security definer set search_path = public as $$
declare
  g public.groups%rowtype;
  v_added int;
begin
  select * into g from public.groups where id = p_group_id and removed_at is null;
  if not found then
    return 0;
  end if;
  insert into public.messages (
    group_id, wa_message_id, sender_jid, sender_phone, sender_name, from_me, from_team, team_member_id,
    message_type, body, sent_at, opens_pending, ignored_as_last, closes_conversation,
    media_path, media_mime, media_size, media_seconds, media_status,
    quoted_wa_id, quoted_body, quoted_sender_jid, quoted_type, forwarded, contact_cards,
    edited_at, original_body, deleted_at)
  select distinct on (m.wa_message_id)
         g.id, m.wa_message_id, m.sender_jid, m.sender_phone, m.sender_name,
         false, m.from_team or m.from_me, m.team_member_id,
         m.message_type, m.body, m.sent_at, coalesce(m.opens_pending, true), coalesce(m.ignored_as_last, false), coalesce(m.closes_conversation, false),
         m.media_path, m.media_mime, m.media_size, m.media_seconds, m.media_status,
         m.quoted_wa_id, m.quoted_body, m.quoted_sender_jid, m.quoted_type, m.forwarded, m.contact_cards,
         m.edited_at, m.original_body, m.deleted_at
    from public.groups s
    join public.messages m on m.group_id = s.id and m.sent_at >= p_since
   where s.company_id = g.company_id and s.jid = g.jid and s.id <> g.id
     and m.anonymized_at is null and m.hidden_at is null
     and not exists (select 1 from public.messages x where x.group_id = g.id and x.wa_message_id = m.wa_message_id)
   order by m.wa_message_id, m.created_at
  on conflict (group_id, wa_message_id) do nothing;
  get diagnostics v_added = row_count;
  if v_added > 0 then
    perform public.rebuild_group_state(g.id, coalesce(g.pending_since, now()));
  end if;
  return v_added;
end;
$$;
revoke all on function public.sync_group_copies_core(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.sync_group_copies_core(uuid, timestamptz) to service_role;

-- botão do administrador: traz agora o que as outras cópias têm (até 30 dias)
create or replace function public.sync_group_copies(p_group_id uuid, p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g public.groups%rowtype;
  v_added int;
begin
  if not public.is_admin() then
    raise exception 'Só administradores sincronizam as cópias do grupo.' using errcode = '42501';
  end if;
  select * into g from public.groups where id = p_group_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Grupo não encontrado.' using errcode = 'P0002';
  end if;
  v_added := public.sync_group_copies_core(g.id, now() - make_interval(days => least(greatest(coalesce(p_days, 30), 1), 30)));
  return jsonb_build_object('added', v_added);
end;
$$;
revoke all on function public.sync_group_copies(uuid, int) from public, anon;
grant execute on function public.sync_group_copies(uuid, int) to authenticated;

-- worker: todos os grupos com mais de uma cópia, nas últimas horas; devolve quantas mensagens e grupos
create or replace function public.sync_all_group_copies(p_hours int default 6)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n int;
  v_added int := 0;
  v_groups int := 0;
  v_since timestamptz := now() - make_interval(hours => least(greatest(coalesce(p_hours, 6), 1), 24 * 30));
begin
  for r in
    select distinct t.id
      from public.groups t
      join public.groups s on s.company_id = t.company_id and s.jid = t.jid and s.id <> t.id
     where t.removed_at is null
       and s.last_message_at >= v_since
       and (t.last_message_at is null or s.last_message_at > t.last_message_at
            or exists (select 1 from public.messages m
                        where m.group_id = s.id and m.sent_at >= v_since
                          and not exists (select 1 from public.messages x where x.group_id = t.id and x.wa_message_id = m.wa_message_id)))
  loop
    v_n := public.sync_group_copies_core(r.id, v_since);
    if v_n > 0 then
      v_added := v_added + v_n;
      v_groups := v_groups + 1;
    end if;
  end loop;
  return jsonb_build_object('added', v_added, 'groups', v_groups);
end;
$$;
revoke all on function public.sync_all_group_copies(int) from public, anon, authenticated;
grant execute on function public.sync_all_group_copies(int) to service_role;

-- 0165 já aplicada em alguns bancos antes desta permissão explícita para o worker
do $$ begin
  if to_regprocedure('public.note_undecrypted_message(uuid,integer,text)') is not null then
    grant execute on function public.note_undecrypted_message(uuid, int, text) to service_role;
  end if;
end $$;
