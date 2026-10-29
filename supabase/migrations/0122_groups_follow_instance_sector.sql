-- =====================================================================
-- Grupos no setor do número de WhatsApp.
--
--  * Grupo novo entra no setor do número pelo qual chegou (0121); número
--    sem setor: o setor padrão da empresa, como antes.
--  * Ao escolher o setor de um número, os grupos dele que estão no setor
--    padrão (ou sem setor, ou no setor anterior do número) passam para o
--    setor escolhido. Grupo colocado à mão em outro setor fica onde está.
--  * Os números que já têm setor levam agora os seus grupos que estão no
--    setor padrão.
-- =====================================================================

create or replace function public.groups_default_sector()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sector_id is null then
    select coalesce(
             (select i.sector_id from public.whatsapp_instances i where i.id = new.instance_id),
             (select s.default_sector_id from public.app_settings s where s.company_id = new.company_id))
      into new.sector_id;
  end if;
  return new;
end;
$$;

drop function if exists public.set_instance_sector(uuid, uuid);
-- devolve quantos grupos foram para o setor
create or replace function public.set_instance_sector(p_instance uuid, p_sector uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_old uuid;
  v_default uuid;
  v_moved int := 0;
begin
  if not public.is_admin() then
    raise exception 'Só administradores mudam o setor do número.' using errcode = '42501';
  end if;
  if p_sector is not null and not exists (select 1 from public.sectors where id = p_sector and company_id = v_company) then
    raise exception 'Setor não encontrado.';
  end if;
  select sector_id into v_old from public.whatsapp_instances where id = p_instance and company_id = v_company;
  if not found then
    raise exception 'Conexão não encontrada.';
  end if;
  update public.whatsapp_instances set sector_id = p_sector where id = p_instance;
  if p_sector is not null then
    select default_sector_id into v_default from public.app_settings where company_id = v_company;
    perform set_config('app.system_notice', 'on', true);
    update public.groups g set sector_id = p_sector
     where g.instance_id = p_instance and g.company_id = v_company
       and (g.sector_id is null or g.sector_id = v_default or g.sector_id = v_old)
       and g.sector_id is distinct from p_sector;
    get diagnostics v_moved = row_count;
    perform set_config('app.system_notice', 'off', true);
  end if;
  return v_moved;
end;
$$;
revoke all on function public.set_instance_sector(uuid, uuid) from public, anon;
grant execute on function public.set_instance_sector(uuid, uuid) to authenticated;

-- números que já têm setor: os grupos deles que estão no setor padrão (ou sem setor) vão para o setor do número
do $$
begin
  perform set_config('app.system_notice', 'on', true);
  update public.groups g set sector_id = i.sector_id
    from public.whatsapp_instances i
    left join public.app_settings s on s.company_id = i.company_id
   where g.instance_id = i.id and i.sector_id is not null
     and (g.sector_id is null or g.sector_id = s.default_sector_id)
     and g.sector_id is distinct from i.sector_id;
  perform set_config('app.system_notice', 'off', true);
end $$;
