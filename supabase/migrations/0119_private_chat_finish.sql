-- =====================================================================
-- Atendimento no privado: aguardando, meus atendimentos e finalizados.
--
--  * Finalizar atendimento: a conversa vai para "Finalizados" (fica com
--    quem atendeu). Se o cliente escrever de novo, ela volta para
--    "Aguardando" (sem responsável) e todos são avisados; se alguém da
--    equipe mandar mensagem por ela, reabre com essa pessoa.
--  * Transferir: para outro administrador ou atendente da empresa, com
--    uma observação opcional que vai no aviso de quem recebe. Transferir
--    uma conversa finalizada reabre o atendimento com quem recebeu.
-- =====================================================================

alter table public.private_chats
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null;
create index if not exists private_chats_closed_idx on public.private_chats (company_id, closed_at);

-- ------------------------------------------------ finalizar e reabrir
create or replace function public.finish_private_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  select * into c from public.private_chats where id = p_chat;
  if c.closed_at is not null then
    return;
  end if;
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador finaliza este atendimento.' using errcode = '42501';
  end if;
  update public.private_chats
     set closed_at = now(), closed_by = v_me, unread_count = 0,
         assigned_to = coalesce(assigned_to, v_me), assigned_at = coalesce(assigned_at, now())
   where id = p_chat;
end;
$$;
revoke all on function public.finish_private_chat(uuid) from public, anon;
grant execute on function public.finish_private_chat(uuid) to authenticated;

create or replace function public.reopen_private_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  update public.private_chats
     set closed_at = null, closed_by = null, assigned_to = auth.uid(), assigned_at = now()
   where id = p_chat and closed_at is not null;
end;
$$;
revoke all on function public.reopen_private_chat(uuid) from public, anon;
grant execute on function public.reopen_private_chat(uuid) to authenticated;

-- cliente escreveu numa conversa finalizada: volta para "Aguardando" (antes do aviso, que então vai
-- para todos). Mensagens antigas da sincronização não reabrem.
create or replace function public.private_messages_reopen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.from_me then
    update public.private_chats
       set closed_at = null, closed_by = null, assigned_to = null, assigned_at = null
     where id = new.chat_id and closed_at is not null and new.sent_at > closed_at;
  end if;
  return new;
end;
$$;
drop trigger if exists private_messages_reopen on public.private_messages;
create trigger private_messages_reopen before insert on public.private_messages
  for each row execute function public.private_messages_reopen();

-- envio pelo painel: na conversa sem responsável assume; na finalizada, reabre com quem enviou
create or replace function public.private_outgoing_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return new;                                   -- worker / sistema
  end if;
  if not public.private_chat_visible(new.chat_id) then
    select assigned_to into v_owner from public.private_chats where id = new.chat_id;
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(v_owner)
      using errcode = '42501';
  end if;
  update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and assigned_to is null;
  update public.private_chats set closed_at = null, closed_by = null, assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and closed_at is not null;
  return new;
end;
$$;

-- ------------------------------------------------ transferir (com observação opcional)
drop function if exists public.assign_private_chat(uuid, uuid);
create or replace function public.assign_private_chat(p_chat uuid, p_user uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  select * into c from public.private_chats where id = p_chat;
  -- sem responsável: qualquer um assume (ou passa para alguém); com responsável: ele ou um administrador
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador muda o responsável desta conversa.' using errcode = '42501';
  end if;
  if p_user is not null and not exists (
       select 1 from public.profiles p
        where p.id = p_user and p.company_id = c.company_id and p.active
          and (p.platform_admin or p.role in ('admin', 'agent'))) then
    raise exception 'Escolha um administrador ou atendente ativo da empresa.';
  end if;
  if p_user is not distinct from c.assigned_to and c.closed_at is null then
    return;
  end if;
  -- transferir uma conversa finalizada reabre o atendimento com quem recebeu
  update public.private_chats
     set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end,
         closed_at = null, closed_by = null
   where id = p_chat;
  -- quem recebeu a conversa de outra pessoa é avisado
  if p_user is not null and p_user <> v_me then
    perform public.queue_push(
      c.company_id, 'private', 'users',
      '💬 Conversa transferida para você',
      coalesce(nullif(btrim(c.name), ''), c.phone, 'Conversa privada') || ' · por ' || public.user_display_name(v_me)
        || coalesce(E'\n' || left(v_note, 160), ''),
      '/private?c=' || c.id, null, array[p_user], 'private:' || c.id, null);
  end if;
end;
$$;
revoke all on function public.assign_private_chat(uuid, uuid, text) from public, anon;
grant execute on function public.assign_private_chat(uuid, uuid, text) to authenticated;

-- quem pode receber uma conversa (para o "Transferir"), com o e-mail para diferenciar nomes repetidos
create or replace function public.private_chat_agents()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', public.user_display_name(p.id), 'email', p.email)
                            order by lower(public.user_display_name(p.id))), '[]'::jsonb)
    from public.profiles p
   where public.can_use_private_chats() and p.company_id = public.current_company_id() and p.active
     and (p.platform_admin or p.role in ('admin', 'agent'))
$$;
grant execute on function public.private_chat_agents() to authenticated;
