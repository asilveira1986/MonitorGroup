-- =====================================================================
-- Conversas privadas: "Liberar conversa" e histórico do atendimento.
--
--  * Liberar (só administradores): tira o responsável e devolve a conversa
--    para "Aguardando". A troca só acontece se a conversa ainda tiver
--    responsável (um único UPDATE com a condição), então dois cliques ou
--    dois administradores ao mesmo tempo não geram estado inconsistente:
--    o segundo recebe "Esta conversa já está sem responsável".
--  * O "sem resposta" não é zerado: nenhuma data de mensagem é tocada; o
--    tempo continua contando da última mensagem do cliente.
--  * Quem perdeu a conversa (released_from) não consegue responder por ela
--    até clicar em "Assumir"; o resto da equipe continua assumindo ao
--    responder, como antes.
--  * Histórico (private_chat_events): assumiu, transferiu, liberou e
--    finalizou, com quem fez, nomes da época, observação e data/hora.
--  * Transferir não devolve mais para "Aguardando" para atendentes: isso
--    passa a ser o "Liberar", dos administradores.
-- =====================================================================

-- ------------------------------------------------ histórico do atendimento
create table if not exists public.private_chat_events (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  chat_id    uuid not null references public.private_chats(id) on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  type       text not null check (type in ('assigned', 'released', 'transferred', 'finished')),
  note       text,
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists private_chat_events_chat_idx on public.private_chat_events (chat_id, created_at);
alter table public.private_chat_events enable row level security;
drop policy if exists private_chat_events_read on public.private_chat_events;
create policy private_chat_events_read on public.private_chat_events for select
  using (company_id = (select public.current_company_id()) and public.private_chat_visible(chat_id));
-- gravado só pelas funções abaixo (security definer)
revoke insert, update, delete on public.private_chat_events from anon, authenticated;
grant select on public.private_chat_events to authenticated;
do $$ begin
  begin alter publication supabase_realtime add table public.private_chat_events; exception when others then null; end;
end $$;

-- quem perdeu a conversa na liberação (bloqueia o envio dele até assumir de novo)
alter table public.private_chats
  add column if not exists released_from uuid references public.profiles(id) on delete set null;

-- qualquer caminho que dê um responsável à conversa tira o bloqueio
create or replace function public.private_chats_clear_released()
returns trigger language plpgsql as $$
begin
  if new.assigned_to is not null then
    new.released_from := null;
  end if;
  return new;
end;
$$;
drop trigger if exists private_chats_clear_released on public.private_chats;
create trigger private_chats_clear_released before update of assigned_to on public.private_chats
  for each row execute function public.private_chats_clear_released();

-- grava um evento com os nomes da época (o histórico não muda se alguém trocar de nome depois)
create or replace function public.log_private_chat_event(
  p_chat uuid, p_type text, p_from uuid default null, p_to uuid default null, p_note text default null, p_extra jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
begin
  select * into c from public.private_chats where id = p_chat;
  if not found then
    return;
  end if;
  insert into public.private_chat_events (company_id, chat_id, user_id, type, note, metadata)
  values (c.company_id, c.id, v_me, p_type, nullif(btrim(coalesce(p_note, '')), ''),
          jsonb_strip_nulls(jsonb_build_object(
            'by_name', case when v_me is not null then public.user_display_name(v_me) end,
            'from', p_from, 'from_name', case when p_from is not null then public.user_display_name(p_from) end,
            'to', p_to, 'to_name', case when p_to is not null then public.user_display_name(p_to) end,
            'customer', coalesce(nullif(btrim(c.name), ''), c.phone)
          )) || coalesce(p_extra, '{}'::jsonb));
end;
$$;
revoke all on function public.log_private_chat_event(uuid, text, uuid, uuid, text, jsonb) from public, anon, authenticated;

-- ------------------------------------------------ liberar (só administradores)
create or replace function public.release_private_chat(p_chat uuid, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_prev uuid;
  v_me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_me is null or not public.private_sees_all() then
    raise exception 'Só administradores podem liberar conversas.' using errcode = '42501';
  end if;
  select * into c from public.private_chats where id = p_chat and company_id = public.current_company_id();
  if not found then
    raise exception 'Conversa não encontrada.' using errcode = 'P0002';
  end if;
  if c.closed_at is not null then
    raise exception 'Este atendimento está finalizado. Reabra a conversa antes de liberar.' using errcode = '22023';
  end if;
  -- troca só se ainda tiver responsável: dois cliques ou dois administradores não se atropelam
  update public.private_chats
     set released_from = assigned_to, assigned_to = null, assigned_at = null
   where id = p_chat and assigned_to is not null and closed_at is null
  returning released_from into v_prev;
  if v_prev is null then
    raise exception 'Esta conversa já está sem responsável.' using errcode = '22023';
  end if;
  perform public.log_private_chat_event(p_chat, 'released', v_prev, null, v_note);
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary, details)
  select c.company_id, p.id, p.email, p.full_name, 'atendimento', 'liberou', 'private_chats', c.id::text,
         'Liberou a conversa com ' || coalesce(nullif(btrim(c.name), ''), c.phone, 'cliente') || ' (era de ' || public.user_display_name(v_prev) || ')',
         jsonb_strip_nulls(jsonb_build_object('motivo', v_note))
    from public.profiles p where p.id = v_me;
  -- quem atendia é avisado
  if v_prev <> v_me then
    perform public.queue_push(
      c.company_id, 'private', 'users',
      '🔓 Conversa liberada',
      coalesce(nullif(btrim(c.name), ''), c.phone, 'Conversa privada') || ' · por ' || public.user_display_name(v_me)
        || coalesce(E'\n' || left(v_note, 160), ''),
      '/private?c=' || c.id, null, array[v_prev], 'private:' || c.id, null);
  end if;
  select * into c from public.private_chats where id = p_chat;
  return to_jsonb(c);
end;
$$;
revoke all on function public.release_private_chat(uuid, text) from public, anon;
grant execute on function public.release_private_chat(uuid, text) to authenticated;

-- ------------------------------------------------ transferir / assumir (com histórico)
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
  -- devolver para "Aguardando" é o "Liberar", dos administradores
  if p_user is null then
    if c.assigned_to is null and c.closed_at is null then
      return;
    end if;
    perform public.release_private_chat(p_chat, v_note);
    return;
  end if;
  -- sem responsável: qualquer um assume (ou passa para alguém); com responsável: ele ou um administrador
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador muda o responsável desta conversa.' using errcode = '42501';
  end if;
  if not exists (
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
     set assigned_to = p_user, assigned_at = now(), closed_at = null, closed_by = null
   where id = p_chat;
  if c.assigned_to is null and p_user = v_me then
    perform public.log_private_chat_event(p_chat, 'assigned', null, p_user, v_note);
  else
    perform public.log_private_chat_event(p_chat, 'transferred', c.assigned_to, p_user, v_note);
  end if;
  -- quem recebeu a conversa de outra pessoa é avisado
  if p_user <> v_me then
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

-- ------------------------------------------------ finalizar e reabrir (com histórico)
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
  perform public.log_private_chat_event(p_chat, 'finished', c.assigned_to, null, null);
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
  if found then
    perform public.log_private_chat_event(p_chat, 'assigned', null, auth.uid(), null, '{"reopened": true}'::jsonb);
  end if;
end;
$$;
revoke all on function public.reopen_private_chat(uuid) from public, anon;
grant execute on function public.reopen_private_chat(uuid) to authenticated;

-- ------------------------------------------------ envio pelo painel
-- na conversa sem responsável assume (com histórico); na finalizada, reabre com quem enviou;
-- quem perdeu a conversa na liberação precisa clicar em "Assumir" antes
create or replace function public.private_outgoing_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
begin
  if auth.uid() is null then
    return new;                                   -- worker / sistema
  end if;
  select * into c from public.private_chats where id = new.chat_id;
  if not public.private_chat_visible(new.chat_id) then
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(c.assigned_to)
      using errcode = '42501';
  end if;
  if c.assigned_to is null and c.closed_at is null and c.released_from = auth.uid() then
    raise exception 'Esta conversa foi liberada por um administrador. Clique em "Assumir" para responder.'
      using errcode = '42501';
  end if;
  update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and assigned_to is null;
  if found then
    perform public.log_private_chat_event(new.chat_id, 'assigned', null, auth.uid(), null, '{"via": "envio"}'::jsonb);
  end if;
  update public.private_chats set closed_at = null, closed_by = null, assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and closed_at is not null;
  if found then
    perform public.log_private_chat_event(new.chat_id, 'assigned', null, auth.uid(), null, '{"reopened": true, "via": "envio"}'::jsonb);
  end if;
  return new;
end;
$$;
