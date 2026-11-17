-- =====================================================================
-- Excluir grupos e conversas privadas pelo sistema (só o administrador
-- geral da plataforma).
--
--  * delete_groups_platform(grupos): apaga grupos da empresa atual, em
--    atividade ou já excluídos do WhatsApp, com mensagens, alertas e o
--    resto em cascata. Devolve quantos foram apagados.
--  * delete_private_chat(conversa): apaga a conversa privada com mensagens,
--    reações, histórico do atendimento e pedidos de recuperação.
--  Se o número conectado continua no grupo/conversa, ele volta a aparecer
--  (vazio) quando chegar uma mensagem nova. Os arquivos guardados no
--  armazenamento não são apagados por aqui.
-- =====================================================================

create or replace function public.delete_groups_platform(p_group_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_count int;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma exclui grupos.' using errcode = '42501';
  end if;
  delete from public.groups where id = any(p_group_ids) and company_id = public.current_company_id();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.delete_groups_platform(uuid[]) from public, anon;
grant execute on function public.delete_groups_platform(uuid[]) to authenticated;

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
