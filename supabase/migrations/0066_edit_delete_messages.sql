-- =====================================================================
-- Editar e apagar mensagens, como no WhatsApp.
--
--  * Pelo painel: mensagens enviadas pelo número conectado (respostas do
--    painel ou do celular conectado). Editar até 15 minutos depois do envio
--    e apagar para todos até 2 dias depois (limites do WhatsApp). Quem
--    respondeu pelo painel edita/apaga as próprias; administradores, todas
--    do número conectado. O worker executa no WhatsApp (message_actions).
--  * Do WhatsApp: quando alguém edita ou apaga uma mensagem no celular, o
--    worker atualiza a conversa (edited_at / deleted_at). O texto original
--    fica guardado (original_body) e o apagado continua consultável.
-- =====================================================================

alter table public.messages
  add column if not exists edited_at timestamptz,
  add column if not exists original_body text,
  add column if not exists deleted_at timestamptz;

create table if not exists public.message_actions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  group_id          uuid not null references public.groups(id) on delete cascade,
  instance_id       uuid not null references public.whatsapp_instances(id) on delete cascade,
  message_id        uuid not null references public.messages(id) on delete cascade,
  action            text not null check (action in ('edit', 'delete')),
  new_body          text,
  status            text not null default 'pending' check (status in ('pending', 'sending', 'done', 'failed')),
  error             text,
  requested_by      uuid references public.profiles(id) on delete set null,
  requested_by_name text,
  created_at        timestamptz not null default now(),
  done_at           timestamptz
);
create index if not exists message_actions_pending_idx on public.message_actions (instance_id, created_at) where status = 'pending';

alter table public.message_actions enable row level security;
drop policy if exists message_actions_read on public.message_actions;
create policy message_actions_read on public.message_actions for select
  using (group_id in (select unnest(public.visible_group_ids())));
grant select on public.message_actions to authenticated;
alter table public.message_actions replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.message_actions; exception when others then null; end;
end $$;

-- pedido do painel: editar (p_body) ou apagar para todos
create or replace function public.request_message_action(p_message_id uuid, p_action text, p_body text default null)
returns public.message_actions
language plpgsql security definer set search_path = public
as $$
declare
  v_msg      public.messages%rowtype;
  v_group    public.groups%rowtype;
  v_name     text;
  v_body     text := btrim(coalesce(p_body, ''));
  v_prefix   text;
  v_row      public.message_actions;
begin
  if not public.can_write() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_action not in ('edit', 'delete') then
    raise exception 'Ação inválida.';
  end if;
  select * into v_msg from public.messages where id = p_message_id;
  if not found then
    raise exception 'Mensagem não encontrada.';
  end if;
  select * into v_group from public.groups where id = v_msg.group_id;
  if v_group.company_id is distinct from public.current_company_id() then
    raise exception 'Mensagem não encontrada.';
  end if;
  if not v_msg.from_me then
    raise exception 'Só dá para editar ou apagar mensagens enviadas pelo número conectado.';
  end if;
  if v_msg.deleted_at is not null then
    raise exception 'Esta mensagem já foi apagada.';
  end if;
  if not (public.is_admin() or public.has_group_permission(v_group.id, 'reply')) then
    raise exception 'Seu setor não tem permissão para responder neste grupo.' using errcode = '42501';
  end if;
  -- quem não é administrador mexe só no que enviou pelo painel
  if not public.is_admin() and not exists (
    select 1 from public.outgoing_messages o
     where o.group_id = v_group.id and o.wa_message_id = v_msg.wa_message_id and o.created_by = auth.uid()) then
    raise exception 'Você só pode editar ou apagar as mensagens que enviou pelo painel.' using errcode = '42501';
  end if;
  if p_action = 'edit' then
    if v_msg.message_type <> 'text' then
      raise exception 'Só mensagens de texto podem ser editadas.';
    end if;
    if v_msg.sent_at < now() - interval '15 minutes' then
      raise exception 'O WhatsApp só permite editar até 15 minutos depois do envio.';
    end if;
    if v_body = '' then
      raise exception 'Escreva a mensagem.';
    end if;
    if length(v_body) > 4000 then
      raise exception 'A mensagem passa de 4000 caracteres.';
    end if;
    -- mantém a assinatura "*Nome:*" das respostas do painel
    v_prefix := substring(v_msg.body from '^(\*[^*\n]+:\*\n)');
    if v_prefix is not null and left(v_body, length(v_prefix)) <> v_prefix then
      v_body := v_prefix || v_body;
    end if;
  elsif v_msg.sent_at < now() - interval '2 days' then
    raise exception 'O WhatsApp só permite apagar para todos até 2 dias depois do envio.';
  end if;
  if exists (select 1 from public.message_actions where message_id = p_message_id and status in ('pending', 'sending')) then
    raise exception 'Já há uma alteração desta mensagem sendo enviada ao WhatsApp.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name from public.profiles where id = auth.uid();
  insert into public.message_actions (company_id, group_id, instance_id, message_id, action, new_body, requested_by, requested_by_name)
  values (v_group.company_id, v_group.id, v_group.instance_id, p_message_id, p_action,
          case when p_action = 'edit' then v_body end, auth.uid(), v_name)
  returning * into v_row;

  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary)
  select v_group.company_id, p.id, p.email, v_name, 'atendimento',
         case when p_action = 'edit' then 'editou' else 'apagou' end, 'messages', p_message_id::text,
         case when p_action = 'edit' then 'Editou uma mensagem no grupo ' else 'Apagou para todos uma mensagem no grupo ' end || v_group.name
  from public.profiles p where p.id = auth.uid();
  return v_row;
end;
$$;
revoke all on function public.request_message_action(uuid, text, text) from public, anon;
grant execute on function public.request_message_action(uuid, text, text) to authenticated;
