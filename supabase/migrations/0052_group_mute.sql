-- =====================================================================
-- Silenciar grupo.
--
-- Silenciar para os AVISOS do grupo para toda a empresa: aviso em tela, voz e
-- som de mensagem nova e o aviso dos alertas (em tela, WhatsApp e e-mail).
-- O grupo continua monitorado: mensagens, pendências, tempos e a lista de
-- Alertas seguem normais. Pode ser por um tempo (1 h, 8 h, 24 h, 7 dias) ou
-- sempre.
--
-- Quem pode: administrador da empresa (qualquer grupo); pessoas dos setores
-- com "Pode silenciar grupos" (Configurações › Setores), nos grupos do setor;
-- quem administra a plataforma: qualquer grupo e "silenciar todos".
-- =====================================================================

alter table public.sectors
  add column if not exists can_mute boolean not null default false;

create table if not exists public.group_mutes (
  group_id    uuid primary key references public.groups(id) on delete cascade,
  company_id  uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  muted_until timestamptz not null,           -- 'infinity' = sempre
  muted_by    uuid,
  muted_by_name text,
  created_at  timestamptz not null default now()
);
create index if not exists group_mutes_company_idx on public.group_mutes (company_id);

alter table public.group_mutes enable row level security;
drop policy if exists group_mutes_read on public.group_mutes;
create policy group_mutes_read on public.group_mutes for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
grant select on public.group_mutes to authenticated;

-- permissão "mute" nos setores
create or replace function public.has_group_permission(p_group_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups where id = p_group_id and company_id = public.current_company_id())
     and public.is_active_user()
     and (p_permission = 'view' or public.can_write())
     and (public.is_admin() or exists (
       select 1
       from public.groups g
       join public.sectors s on s.id = g.sector_id
       join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
       where g.id = p_group_id
         and case p_permission
               when 'view' then true
               when 'reply' then s.can_reply
               when 'demands' then s.can_manage_demands
               when 'alerts' then s.can_handle_alerts
               when 'mute' then s.can_mute
               else false
             end
     ))
$$;

-- silenciar / reativar um grupo (p_until null = reativar)
create or replace function public.set_group_mute(p_group_id uuid, p_until timestamptz)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid;
  v_name    text;
begin
  select company_id into v_company from public.groups where id = p_group_id;
  if v_company is null or v_company is distinct from public.current_company_id() then
    raise exception 'Grupo não encontrado.';
  end if;
  if not (public.is_platform_admin() or public.has_group_permission(p_group_id, 'mute')) then
    raise exception 'Você não tem permissão para silenciar este grupo.' using errcode = '42501';
  end if;
  if p_until is null or p_until <= now() then
    delete from public.group_mutes where group_id = p_group_id;
  else
    select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
    insert into public.group_mutes (group_id, company_id, muted_until, muted_by, muted_by_name)
    values (p_group_id, v_company, p_until, auth.uid(), v_name)
    on conflict (group_id) do update
      set muted_until = excluded.muted_until, muted_by = excluded.muted_by,
          muted_by_name = excluded.muted_by_name, created_at = now();
  end if;
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary)
  select v_company, p.id, p.email, coalesce(nullif(p.full_name, ''), p.email), 'grupos',
         case when p_until is null or p_until <= now() then 'reativou' else 'silenciou' end, 'groups', p_group_id::text,
         case when p_until is null or p_until <= now() then 'Reativou os avisos do grupo '
              else 'Silenciou o grupo ' end || (select name from public.groups where id = p_group_id)
         || case when p_until = 'infinity' then ' (sempre)'
                 when p_until > now() then ' até ' || to_char(p_until at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') else '' end
  from public.profiles p where p.id = auth.uid();
end;
$$;
revoke all on function public.set_group_mute(uuid, timestamptz) from public, anon;
grant execute on function public.set_group_mute(uuid, timestamptz) to authenticated;

-- quem administra a plataforma: silenciar / reativar todos os grupos da empresa atual
create or replace function public.set_company_mute(p_until timestamptz)
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_company uuid := public.current_company_id();
  v_name    text;
  v_n       int;
begin
  if not public.is_platform_admin() then
    raise exception 'Somente quem administra a plataforma silencia todos os grupos.' using errcode = '42501';
  end if;
  if p_until is null or p_until <= now() then
    delete from public.group_mutes where company_id = v_company;
    get diagnostics v_n = row_count;
  else
    select coalesce(nullif(full_name, ''), email) into v_name from public.profiles where id = auth.uid();
    insert into public.group_mutes (group_id, company_id, muted_until, muted_by, muted_by_name)
    select g.id, v_company, p_until, auth.uid(), v_name
    from public.groups g where g.company_id = v_company and g.removed_at is null
    on conflict (group_id) do update
      set muted_until = excluded.muted_until, muted_by = excluded.muted_by,
          muted_by_name = excluded.muted_by_name, created_at = now();
    get diagnostics v_n = row_count;
  end if;
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, summary)
  select v_company, p.id, p.email, coalesce(nullif(p.full_name, ''), p.email), 'grupos',
         case when p_until is null or p_until <= now() then 'reativou' else 'silenciou' end, 'groups',
         case when p_until is null or p_until <= now() then 'Reativou os avisos de todos os grupos (' || v_n || ')'
              else 'Silenciou todos os grupos (' || v_n || ')' || case when p_until = 'infinity' then ' sempre'
                   else ' até ' || to_char(p_until at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') end end
  from public.profiles p where p.id = auth.uid();
  return v_n;
end;
$$;
revoke all on function public.set_company_mute(timestamptz) from public, anon;
grant execute on function public.set_company_mute(timestamptz) to authenticated;
