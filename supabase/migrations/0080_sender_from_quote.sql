-- =====================================================================
-- Remetente pela citação.
--
-- Quando alguém responde citando uma mensagem que foi gravada sem
-- remetente (0078), a citação traz quem escreveu a original: o worker
-- completa o remetente e, se for da equipe (ou o número conectado), passa
-- a mensagem para a equipe e refaz tempos e pendência do grupo.
-- =====================================================================

create or replace function public.identify_message_sender(
  p_message_id uuid, p_jid text, p_phone text default null, p_name text default null,
  p_team_member_id uuid default null, p_team boolean default false
)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_group uuid;
  v_pending timestamptz;
begin
  update public.messages
     set sender_jid = p_jid,
         sender_phone = coalesce(sender_phone, nullif(p_phone, '')),
         sender_name = coalesce(sender_name, nullif(p_name, '')),
         from_team = from_team or coalesce(p_team, false),
         team_member_id = coalesce(team_member_id, p_team_member_id)
   where id = p_message_id and sender_jid is null and not from_me and nullif(p_jid, '') is not null
  returning group_id into v_group;
  if v_group is null then
    return false;
  end if;
  if coalesce(p_team, false) then
    select pending_since into v_pending from public.groups where id = v_group;
    perform public.rebuild_group_state(v_group, coalesce(v_pending, now()));
    update public.alerts a set status = 'resolved', resolved_at = now()
      from public.groups g
     where g.id = a.group_id and g.id = v_group and g.pending_since is null
       and a.type = 'no_response' and a.status <> 'resolved';
  end if;
  return true;
end;
$$;
revoke all on function public.identify_message_sender(uuid, text, text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.identify_message_sender(uuid, text, text, text, uuid, boolean) to service_role;
