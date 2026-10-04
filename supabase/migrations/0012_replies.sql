-- =====================================================================
-- Responder os grupos pelo painel.
--
-- O painel grava a mensagem numa fila (outgoing_messages) e o worker a
-- envia pela mesma conexão do WhatsApp lida no QR code. Como é um
-- aparelho conectado ao número, a mensagem aparece também no celular,
-- igual a uma mensagem enviada pelo WhatsApp Web.
-- A função é ligada/desligada em Configurações › Geral (só admin).
-- =====================================================================

alter table public.app_settings
  add column if not exists reply_enabled boolean not null default false,
  -- assina a mensagem com o nome de quem respondeu ("*Ana:*")
  add column if not exists reply_sign_name boolean not null default true,
  -- quem pode responder: todos os usuários ativos ou só administradores
  add column if not exists reply_allowed text not null default 'all';

do $$
begin
  alter table public.app_settings add constraint app_settings_reply_allowed_check check (reply_allowed in ('all', 'admin'));
exception when duplicate_object then null;
end $$;

create table if not exists public.outgoing_messages (
  id                 uuid primary key default gen_random_uuid(),
  group_id           uuid not null references public.groups(id) on delete cascade,
  instance_id        uuid not null references public.whatsapp_instances(id) on delete cascade,
  -- texto digitado (sem assinatura) e texto efetivamente enviado
  body               text not null,
  text_to_send       text not null,
  quoted_message_id  uuid references public.messages(id) on delete set null,
  status             text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'failed')),
  error              text,
  wa_message_id      text,
  sender_name        text not null,
  created_by         uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  sent_at            timestamptz
);

create index if not exists outgoing_messages_pending_idx on public.outgoing_messages (created_at) where status = 'pending';
create index if not exists outgoing_messages_group_idx on public.outgoing_messages (group_id, created_at desc);

alter table public.outgoing_messages enable row level security;
drop policy if exists outgoing_read on public.outgoing_messages;
create policy outgoing_read on public.outgoing_messages for select using (public.is_active_user());
-- escrita só pelas funções abaixo (e pelo worker, com a service_role)

-- ---------------------------------------------------------------------
-- Enviar
-- ---------------------------------------------------------------------
create or replace function public.can_reply()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_active_user()
     and s.reply_enabled
     and (s.reply_allowed = 'all' or public.is_admin())
  from public.app_settings s where s.id = 1
$$;

create or replace function public.send_group_message(
  p_group_id uuid, p_body text, p_quoted_message_id uuid default null
)
returns public.outgoing_messages
language plpgsql security definer set search_path = public
as $$
declare
  v_settings public.app_settings%rowtype;
  v_group    public.groups%rowtype;
  v_name     text;
  v_body     text := btrim(coalesce(p_body, ''));
  v_row      public.outgoing_messages;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_settings from public.app_settings where id = 1;
  if not v_settings.reply_enabled then
    raise exception 'Responder pelo sistema está desligado. Um administrador pode ativar em Configurações › Geral.';
  end if;
  if v_settings.reply_allowed = 'admin' and not public.is_admin() then
    raise exception 'Só administradores podem responder pelo sistema.' using errcode = '42501';
  end if;
  if v_body = '' then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then
    raise exception 'Grupo não encontrado.';
  end if;
  if v_group.removed_at is not null then
    raise exception 'O número conectado não participa mais deste grupo.';
  end if;
  if not v_group.monitored then
    raise exception 'Ative o monitoramento do grupo para responder por aqui.';
  end if;
  if p_quoted_message_id is not null
     and not exists (select 1 from public.messages where id = p_quoted_message_id and group_id = p_group_id) then
    raise exception 'Mensagem citada não pertence a este grupo.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name
  from public.profiles where id = auth.uid();

  insert into public.outgoing_messages
    (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by)
  values
    (p_group_id, v_group.instance_id, v_body,
     case when v_settings.reply_sign_name then '*' || v_name || ':*' || E'\n' || v_body else v_body end,
     p_quoted_message_id, v_name, auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

-- tentar de novo uma mensagem que falhou
create or replace function public.retry_group_message(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_reply() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.outgoing_messages
  set status = 'pending', error = null, created_at = now()
  where id = p_id and status = 'failed';
end;
$$;

-- descartar uma mensagem que falhou (ou que ainda não saiu)
create or replace function public.discard_group_message(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.outgoing_messages
  where id = p_id and status in ('pending', 'failed')
    and (created_by = auth.uid() or public.is_admin());
end;
$$;

revoke all on function public.send_group_message(uuid, text, uuid) from public, anon;
revoke all on function public.retry_group_message(uuid) from public, anon;
revoke all on function public.discard_group_message(uuid) from public, anon;
revoke all on function public.can_reply() from public, anon;
grant execute on function public.send_group_message(uuid, text, uuid) to authenticated;
grant execute on function public.retry_group_message(uuid) to authenticated;
grant execute on function public.discard_group_message(uuid) to authenticated;
grant execute on function public.can_reply() to authenticated;

-- tempo real: a tela acompanha "enviando…" / "enviada" / "falhou"
do $$
begin
  begin alter publication supabase_realtime add table public.outgoing_messages; exception when others then null; end;
end $$;
