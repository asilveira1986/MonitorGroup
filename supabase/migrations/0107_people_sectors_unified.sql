-- =====================================================================
-- Configurações sem cadastro duplicado.
--
--  * Pessoas: o acesso ao painel (profiles) e o atendente (team_members)
--    da mesma pessoa (mesmo e-mail) ficam com o mesmo nome e o mesmo
--    telefone. Mudou num, muda no outro (Meu perfil, Configurações ›
--    Pessoas). Os cadastros atuais são completados um pelo outro.
--  * Setores: um só tipo de setor. Os setores da agenda viram Setores
--    (com as mesmas pessoas); a agenda passa a usar os Setores para marcar
--    compromissos e ver a agenda do setor. Setor novo não tem grupos,
--    então não muda o que ninguém vê nos grupos.
-- =====================================================================

-- telefone só com dígitos e com 55 no Brasil (DDD + número)
create or replace function public.br_phone(p_phone text)
returns text language sql immutable as $$
  select case when length(d) between 10 and 11 then '55' || d else nullif(d, '') end
    from (select regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') as d) x
$$;

-- ------------------------------------------------ pessoas: nome e telefone iguais nos dois cadastros
create or replace function public.profiles_sync_team()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  begin
    update public.team_members t
       set name = coalesce(nullif(btrim(new.full_name), ''), t.name),
           phone = case when public.br_phone(new.phone) is not null then public.br_phone(new.phone) else t.phone end
     where t.company_id = new.company_id and lower(t.user_email) = lower(new.email)
       and (t.name is distinct from coalesce(nullif(btrim(new.full_name), ''), t.name)
            or (public.br_phone(new.phone) is not null
                and public.phone_key(t.phone) is distinct from public.phone_key(public.br_phone(new.phone))));
  exception when unique_violation then
    -- o telefone já é de outra pessoa da equipe: muda só o nome
    update public.team_members t set name = coalesce(nullif(btrim(new.full_name), ''), t.name)
     where t.company_id = new.company_id and lower(t.user_email) = lower(new.email);
  end;
  return new;
end;
$$;
drop trigger if exists profiles_sync_team on public.profiles;
create trigger profiles_sync_team after update of full_name, phone on public.profiles
  for each row execute function public.profiles_sync_team();

create or replace function public.team_sync_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.user_email is null then
    return new;
  end if;
  update public.profiles p
     set full_name = coalesce(nullif(btrim(new.name), ''), p.full_name),
         phone = coalesce(new.phone, p.phone)
   where p.company_id = new.company_id and lower(p.email) = lower(new.user_email)
     and (p.full_name is distinct from coalesce(nullif(btrim(new.name), ''), p.full_name)
          or (new.phone is not null and public.phone_key(public.br_phone(p.phone)) is distinct from public.phone_key(new.phone)));
  return new;
end;
$$;
drop trigger if exists team_sync_profile on public.team_members;
create trigger team_sync_profile after insert or update of name, phone, user_email on public.team_members
  for each row execute function public.team_sync_profile();

-- completa um cadastro pelo outro (sem trocar o que já está preenchido)
update public.profiles p
   set phone = t.phone
  from public.team_members t
 where t.company_id = p.company_id and lower(t.user_email) = lower(p.email)
   and nullif(btrim(coalesce(p.phone, '')), '') is null and t.phone is not null;
update public.profiles p
   set full_name = t.name
  from public.team_members t
 where t.company_id = p.company_id and lower(t.user_email) = lower(p.email)
   and nullif(btrim(coalesce(p.full_name, '')), '') is null;
do $$
declare
  r record;
begin
  for r in
    select t.id, public.br_phone(p.phone) as phone
      from public.team_members t
      join public.profiles p on p.company_id = t.company_id and lower(p.email) = lower(t.user_email)
     where t.phone is null and public.br_phone(p.phone) is not null
  loop
    begin
      update public.team_members set phone = r.phone where id = r.id;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

-- ------------------------------------------------ setores: os da agenda viram Setores
do $$
declare
  a record;
  v_name text;
  v_sector uuid;
begin
  if to_regclass('public.agenda_teams') is null then
    return;
  end if;
  for a in select * from public.agenda_teams loop
    -- mesmo nome de um setor que já existe: fica "<nome> (agenda)", para não dar a ninguém os grupos dele
    v_name := a.name;
    if exists (select 1 from public.sectors s where s.company_id = a.company_id and lower(s.name) = lower(v_name)) then
      v_name := left(a.name, 60) || ' (agenda)';
    end if;
    select id into v_sector from public.sectors where company_id = a.company_id and lower(name) = lower(v_name);
    if v_sector is null then
      insert into public.sectors (company_id, name, description)
      values (a.company_id, v_name, 'Criado a partir do setor da agenda')
      returning id into v_sector;
    end if;
    insert into public.sector_members (sector_id, user_id)
    select v_sector, m.user_id from public.agenda_team_members m where m.team_id = a.id
    on conflict do nothing;
  end loop;
  -- os setores da agenda já foram copiados: a tabela fica vazia (e sai de uso)
  delete from public.agenda_teams;
end $$;

-- setores com as pessoas de cada um, para marcar compromissos (qualquer usuário da empresa vê;
-- a lista de membros dos setores em si continua só para administradores)
create or replace function public.agenda_sectors()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'name', s.name,
           'user_ids', coalesce((select jsonb_agg(m.user_id) from public.sector_members m
                                   join public.profiles p on p.id = m.user_id and p.active
                                  where m.sector_id = s.id), '[]'::jsonb))
           order by s.name), '[]'::jsonb)
    from public.sectors s
   where public.is_active_user() and s.company_id = public.current_company_id()
$$;
grant execute on function public.agenda_sectors() to authenticated;
