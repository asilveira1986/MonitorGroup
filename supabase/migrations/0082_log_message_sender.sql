-- =====================================================================
-- "Quem enviou?" (0078) passa a ficar no log de atividades, com como a
-- mensagem estava antes, para dar para conferir e desfazer.
-- =====================================================================

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

  -- log (aba Log): guarda como estava, para dar para desfazer
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary, details)
  select v_grp.company_id, p.id, p.email, coalesce(nullif(p.full_name, ''), p.email), 'atendimento', 'alterou', 'messages', p_message_id::text,
         'Quem enviou (' || v_grp.name || '): ' || coalesce(v_name || ' (equipe)', 'cliente'),
         jsonb_build_object('group_id', v_grp.id, 'antes', jsonb_build_object(
           'from_team', v_msg.from_team, 'team_member_id', v_msg.team_member_id, 'sender_name', v_msg.sender_name))
    from public.profiles p where p.id = auth.uid();

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
