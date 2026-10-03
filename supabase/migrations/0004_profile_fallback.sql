-- =====================================================================
-- Garante o perfil de usuários criados ANTES de o esquema existir
-- (ex.: usuário criado no painel do Supabase antes de rodar o 0001).
-- =====================================================================

-- Cria o perfil do usuário logado se ele ainda não existir,
-- seguindo as mesmas regras do cadastro automático.
create or replace function public.ensure_profile()
returns public.profiles
language plpgsql
security definer set search_path = public
as $$
declare
  v_profile public.profiles%rowtype;
  v_user    auth.users%rowtype;
  v_allowed public.allowed_emails%rowtype;
  v_first   boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v_profile from public.profiles where id = auth.uid();
  if found then
    return v_profile;
  end if;

  select * into v_user from auth.users where id = auth.uid();
  select not exists (select 1 from public.profiles where role = 'admin' and active) into v_first;
  select * into v_allowed from public.allowed_emails where email = lower(v_user.email);

  insert into public.profiles (id, email, full_name, avatar_url, role, active)
  values (
    v_user.id,
    lower(v_user.email),
    coalesce(v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name'),
    v_user.raw_user_meta_data->>'avatar_url',
    case when v_first then 'admin' else coalesce(v_allowed.role, 'agent') end,
    v_first or v_allowed.email is not null
  )
  -- várias requisições simultâneas podem chegar aqui ao mesmo tempo
  on conflict (id) do nothing;

  select * into v_profile from public.profiles where id = auth.uid();
  return v_profile;
end;
$$;

grant execute on function public.ensure_profile() to authenticated;

-- Corrige quem já foi criado antes: se ainda não há nenhum administrador,
-- o usuário mais antigo vira administrador.
insert into public.profiles (id, email, full_name, avatar_url, role, active)
select
  u.id,
  lower(u.email),
  coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name'),
  u.raw_user_meta_data->>'avatar_url',
  'agent',
  exists (select 1 from public.allowed_emails a where a.email = lower(u.email))
from auth.users u
where u.email is not null
  and not exists (select 1 from public.profiles p where p.id = u.id);

update public.profiles set role = 'admin', active = true
where id = (
    select p.id from public.profiles p join auth.users u on u.id = p.id
    order by u.created_at limit 1
  )
  and not exists (select 1 from public.profiles where role = 'admin' and active);
