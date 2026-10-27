-- =====================================================================
-- Etiquetas de clientes: marcar grupos e conversas privadas.
--
--  * customer_tags: as etiquetas da empresa (nome e cor), por exemplo
--    "VIP", "Inadimplente", "Novo cliente". Quem pode alterar dados cria
--    na hora de etiquetar; o administrador renomeia, troca a cor e exclui
--    em Configurações › Etiquetas.
--  * groups.tags e private_chats.tags: as etiquetas de cada um. Quem vê o
--    grupo (e não é só de ver painéis) etiqueta; nas conversas privadas,
--    quem usa as conversas privadas.
--  * Excluir uma etiqueta tira ela de todos os grupos e conversas.
-- =====================================================================

create table if not exists public.customer_tags (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name       text not null check (length(btrim(name)) between 1 and 40),
  color      text not null default 'blue'
             check (color in ('blue', 'green', 'orange', 'red', 'purple', 'pink', 'teal', 'yellow', 'gray')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table public.customer_tags enable row level security;
drop policy if exists customer_tags_read on public.customer_tags;
create policy customer_tags_read on public.customer_tags for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
-- renomear, trocar a cor e excluir: administradores (criar: create_customer_tag)
drop policy if exists customer_tags_admin_update on public.customer_tags;
create policy customer_tags_admin_update on public.customer_tags for update
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));
drop policy if exists customer_tags_admin_delete on public.customer_tags;
create policy customer_tags_admin_delete on public.customer_tags for delete
  using ((select public.is_admin()) and company_id = (select public.current_company_id()));
grant select, update, delete on public.customer_tags to authenticated;

alter table public.groups add column if not exists tags uuid[] not null default '{}';
alter table public.private_chats add column if not exists tags uuid[] not null default '{}';
create index if not exists groups_tags_idx on public.groups using gin (tags);
create index if not exists private_chats_tags_idx on public.private_chats using gin (tags);

-- nova etiqueta (ou a que já existe com o mesmo nome)
create or replace function public.create_customer_tag(p_name text, p_color text default 'blue')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_name text := nullif(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), '');
  v_id uuid;
begin
  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Informe o nome da etiqueta.';
  end if;
  select id into v_id from public.customer_tags where company_id = public.current_company_id() and lower(name) = lower(v_name);
  if v_id is not null then
    return v_id;
  end if;
  insert into public.customer_tags (company_id, name, color, created_by)
  values (public.current_company_id(), left(v_name, 40),
          case when p_color in ('blue', 'green', 'orange', 'red', 'purple', 'pink', 'teal', 'yellow', 'gray') then p_color else 'blue' end,
          auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.create_customer_tag(text, text) from public, anon;
grant execute on function public.create_customer_tag(text, text) to authenticated;

-- só etiquetas desta empresa, sem repetir
create or replace function public.clean_customer_tags(p_tags uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(t.id order by t.name), '{}')
    from public.customer_tags t
   where t.id = any(coalesce(p_tags, '{}')) and t.company_id = public.current_company_id()
$$;
revoke all on function public.clean_customer_tags(uuid[]) from public, anon, authenticated;

create or replace function public.set_group_tags(p_group uuid, p_tags uuid[])
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_tags uuid[] := public.clean_customer_tags(p_tags);
begin
  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;
  if not (p_group = any(public.visible_group_ids())) then
    raise exception 'Grupo não encontrado.';
  end if;
  update public.groups set tags = v_tags where id = p_group;
  return v_tags;
end;
$$;
revoke all on function public.set_group_tags(uuid, uuid[]) from public, anon;
grant execute on function public.set_group_tags(uuid, uuid[]) to authenticated;

create or replace function public.set_private_chat_tags(p_chat uuid, p_tags uuid[])
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_tags uuid[] := public.clean_customer_tags(p_tags);
begin
  if not public.can_use_private_chats()
     or not exists (select 1 from public.private_chats where id = p_chat and company_id = public.current_company_id()) then
    raise exception 'Conversa não encontrada.';
  end if;
  update public.private_chats set tags = v_tags where id = p_chat;
  return v_tags;
end;
$$;
revoke all on function public.set_private_chat_tags(uuid, uuid[]) from public, anon;
grant execute on function public.set_private_chat_tags(uuid, uuid[]) to authenticated;

-- etiqueta excluída: sai dos grupos e das conversas
create or replace function public.customer_tags_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.system_notice', 'on', true);
  update public.groups set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  perform set_config('app.system_notice', 'off', true);
  update public.private_chats set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  return old;
end;
$$;
drop trigger if exists customer_tags_cleanup on public.customer_tags;
create trigger customer_tags_cleanup after delete on public.customer_tags
  for each row execute function public.customer_tags_cleanup();
