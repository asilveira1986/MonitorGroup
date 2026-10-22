-- =====================================================================
-- Conversas privadas, fase 2: arquivos, reações, editar e apagar.
--
--  * Imagens, áudios, vídeos e documentos guardados no Storage (bucket
--    privado "media", pasta <empresa>/private/...), abertos por link
--    temporário (rota /private-media/<id>), nas regras de guarda da empresa.
--  * Reações (👍 ❤️ ...) recebidas e enviadas pelo painel.
--  * Editar (até 15 min), apagar para todos (até 2 dias) e apagar para
--    mim (sem prazo), como nos grupos; também as feitas no próprio WhatsApp.
-- Tudo só para quem administra a plataforma, na empresa com o módulo ligado.
-- =====================================================================

alter table public.private_messages
  add column if not exists media_path text,
  add column if not exists media_mime text,
  add column if not exists media_size bigint,
  add column if not exists media_status text,
  add column if not exists edited_at timestamptz,
  add column if not exists original_body text,
  add column if not exists deleted_at timestamptz,
  add column if not exists hidden_at timestamptz;

create table if not exists public.private_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.private_messages(id) on delete cascade,
  chat_id     uuid not null references public.private_chats(id) on delete cascade,
  company_id  uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  reactor_jid text not null,
  from_me     boolean not null default false,
  emoji       text not null,
  reacted_at  timestamptz not null default now(),
  unique (message_id, reactor_jid)
);
create index if not exists private_reactions_chat_idx on public.private_reactions (chat_id);

create table if not exists public.private_actions (
  id           uuid primary key default gen_random_uuid(),
  chat_id      uuid not null references public.private_chats(id) on delete cascade,
  company_id   uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  instance_id  uuid not null references public.whatsapp_instances(id) on delete cascade,
  message_id   uuid not null references public.private_messages(id) on delete cascade,
  action       text not null check (action in ('edit', 'delete', 'delete_me', 'react')),
  new_body     text,
  emoji        text,
  status       text not null default 'pending' check (status in ('pending', 'sending', 'done', 'failed')),
  error        text,
  requested_by uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  done_at      timestamptz
);
create index if not exists private_actions_pending_idx on public.private_actions (instance_id, created_at) where status = 'pending';

alter table public.private_reactions enable row level security;
alter table public.private_actions enable row level security;
drop policy if exists private_reactions_read on public.private_reactions;
create policy private_reactions_read on public.private_reactions for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
drop policy if exists private_actions_read on public.private_actions;
create policy private_actions_read on public.private_actions for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
grant select on public.private_reactions, public.private_actions to authenticated;
alter table public.private_reactions replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.private_reactions; exception when others then null; end;
  begin alter publication supabase_realtime add table public.private_actions; exception when others then null; end;
end $$;

-- pedido do painel: editar, apagar (para todos / para mim) ou reagir (p_emoji '' = tirar a reação)
create or replace function public.request_private_action(p_message_id uuid, p_action text, p_body text default null, p_emoji text default null)
returns public.private_actions
language plpgsql security definer set search_path = public
as $$
declare
  v_msg  public.private_messages%rowtype;
  v_chat public.private_chats%rowtype;
  v_body text := btrim(coalesce(p_body, ''));
  v_row  public.private_actions;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  if p_action not in ('edit', 'delete', 'delete_me', 'react') then
    raise exception 'Ação inválida.';
  end if;
  select * into v_msg from public.private_messages where id = p_message_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Mensagem não encontrada.';
  end if;
  select * into v_chat from public.private_chats where id = v_msg.chat_id;
  if v_msg.hidden_at is not null then
    raise exception 'Esta mensagem já foi apagada para você.';
  end if;
  if p_action in ('edit', 'delete', 'react') and v_msg.deleted_at is not null then
    raise exception 'Esta mensagem foi apagada.';
  end if;
  if p_action in ('edit', 'delete') and not v_msg.from_me then
    raise exception 'Só dá para editar ou apagar para todos as mensagens enviadas pelo número conectado.';
  end if;
  if p_action = 'edit' then
    if v_msg.message_type <> 'text' then
      raise exception 'Só mensagens de texto podem ser editadas.';
    end if;
    if v_msg.sent_at < now() - interval '15 minutes' then
      raise exception 'O WhatsApp só permite editar até 15 minutos depois do envio.';
    end if;
    if v_body = '' or length(v_body) > 4000 then
      raise exception 'Escreva a mensagem (até 4000 caracteres).';
    end if;
  elsif p_action = 'delete' and v_msg.sent_at < now() - interval '2 days' then
    raise exception 'O WhatsApp só permite apagar para todos até 2 dias depois do envio.';
  elsif p_action = 'react' and length(coalesce(p_emoji, '')) > 16 then
    raise exception 'Reação inválida.';
  end if;
  if exists (select 1 from public.private_actions where message_id = p_message_id and status in ('pending', 'sending') and action = p_action) then
    raise exception 'Já há uma alteração desta mensagem sendo enviada ao WhatsApp.';
  end if;

  insert into public.private_actions (chat_id, company_id, instance_id, message_id, action, new_body, emoji, requested_by)
  values (v_chat.id, v_chat.company_id, v_chat.instance_id, p_message_id, p_action,
          case when p_action = 'edit' then v_body end,
          case when p_action = 'react' then coalesce(p_emoji, '') end, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.request_private_action(uuid, text, text, text) from public, anon;
grant execute on function public.request_private_action(uuid, text, text, text) to authenticated;

-- a conversa mostra como última mensagem a mais recente ainda visível
create or replace function public.refresh_private_chat_preview(p_chat_id uuid)
returns void
language sql security definer set search_path = public
as $$
  update public.private_chats c
     set last_message_preview = coalesce((
       select case when m.deleted_at is not null then '🚫 Mensagem apagada'
                   else left(coalesce(m.body, '[' || m.message_type || ']'), 140) end
         from public.private_messages m
        where m.chat_id = c.id and m.hidden_at is null
        order by m.sent_at desc limit 1), null)
   where c.id = p_chat_id;
$$;
revoke all on function public.refresh_private_chat_preview(uuid) from public, anon, authenticated;
grant execute on function public.refresh_private_chat_preview(uuid) to service_role;
