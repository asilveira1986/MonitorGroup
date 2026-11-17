-- =====================================================================
-- Excluir conversas privadas pelo sistema (só o administrador geral da
-- plataforma).
--
--  * delete_private_chat(conversa): apaga a conversa privada com mensagens,
--    reações, histórico do atendimento e pedidos de recuperação.
--  Se o contato escrever de novo, começa uma conversa nova. Os arquivos
--  guardados no armazenamento não são apagados por aqui.
-- =====================================================================

create or replace function public.delete_private_chat(p_chat uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma exclui conversas privadas.' using errcode = '42501';
  end if;
  delete from public.private_chats where id = p_chat and company_id = public.current_company_id();
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
end;
$$;
revoke all on function public.delete_private_chat(uuid) from public, anon;
grant execute on function public.delete_private_chat(uuid) to authenticated;
