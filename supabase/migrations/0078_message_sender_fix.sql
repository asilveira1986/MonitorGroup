-- =====================================================================
-- Mensagens sem remetente (sem LID, número nem nome).
--
-- Algumas mensagens chegam do WhatsApp com o remetente fora do campo
-- usual (mensagens reenviadas depois de falha na decodificação e parte do
-- histórico). Ficavam como "Cliente", sem como reconhecer a equipe.
--  * o worker lê o remetente também desses campos e, ao importar o
--    histórico de novo, completa as mensagens já gravadas sem remetente
--    (fill_message_senders);
--  * no painel, "quem enviou?" marca à mão uma mensagem sem remetente como
--    de um atendente ou do cliente (set_message_sender) e refaz o grupo.
-- =====================================================================

-- worker: completa o remetente das mensagens já gravadas sem ele
create or replace function public.fill_message_senders(p_rows jsonb)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  update public.messages m
     set sender_jid = r.jid,
         sender_phone = coalesce(m.sender_phone, nullif(r.phone, '')),
         sender_name = coalesce(m.sender_name, nullif(r.name, ''))
    from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as r(group_id uuid, wa_message_id text, jid text, phone text, name text)
   where m.group_id = r.group_id and m.wa_message_id = r.wa_message_id
     and m.sender_jid is null and not m.from_me and nullif(r.jid, '') is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.fill_message_senders(jsonb) from public, anon, authenticated;
grant execute on function public.fill_message_senders(jsonb) to service_role;

-- painel: quem enviou uma mensagem sem remetente (p_team_member_id null = cliente)
create or replace function public.set_message_sender(p_message_id uuid, p_team_member_id uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_msg  public.messages%rowtype;
  v_grp  public.groups%rowtype;
  v_name text;
begin
  if not public.can_write() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_msg from public.messages where id = p_message_id;
  select * into v_grp from public.groups where id = v_msg.group_id;
  if v_msg.id is null or v_grp.company_id is distinct from public.current_company_id()
     or not public.has_group_permission(v_grp.id, 'view') then
    raise exception 'Mensagem não encontrada.';
  end if;
  if v_msg.from_me then
    raise exception 'Mensagens do número conectado já contam como da equipe.';
  end if;
  if p_team_member_id is not null then
    select name into v_name from public.team_members where id = p_team_member_id and company_id = v_grp.company_id;
    if v_name is null then
      raise exception 'Atendente não encontrado.';
    end if;
  end if;

  update public.messages
     set from_team = p_team_member_id is not null,
         team_member_id = p_team_member_id,
         sender_name = case when p_team_member_id is not null then coalesce(sender_name, v_name) else sender_name end
   where id = p_message_id;

  -- refaz tempos de resposta e a situação do grupo
  perform public.rebuild_group_state(v_grp.id, coalesce(v_grp.pending_since, now()));
  update public.alerts a set status = 'resolved', resolved_at = now()
    from public.groups g
   where g.id = a.group_id and g.id = v_grp.id and g.pending_since is null
     and a.type = 'no_response' and a.status <> 'resolved';
end;
$$;
revoke all on function public.set_message_sender(uuid, uuid) from public, anon;
grant execute on function public.set_message_sender(uuid, uuid) to authenticated;
