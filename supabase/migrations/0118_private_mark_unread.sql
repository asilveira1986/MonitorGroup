-- =====================================================================
-- Conversa privada: marcar como não lida.
--
--  * "Marcar como não lida" no topo da conversa: ela volta a contar como
--    não lida (o número na lista e no menu) até alguém abri-la de novo.
--  * Só na conversa que a pessoa vê (as suas, as sem responsável e, para
--    administradores, todas).
-- =====================================================================

create or replace function public.mark_private_chat_unread(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.private_chat_visible(p_chat_id) then
    raise exception 'Conversa não encontrada.';
  end if;
  update public.private_chats set unread_count = greatest(unread_count, 1) where id = p_chat_id;
end;
$$;
revoke all on function public.mark_private_chat_unread(uuid) from public, anon;
grant execute on function public.mark_private_chat_unread(uuid) to authenticated;
