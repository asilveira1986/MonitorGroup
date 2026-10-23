-- =====================================================================
-- Meu perfil: cada usuário edita o próprio nome, telefone e foto pelo
-- menu lateral (onde aparece o nome dele). A foto fica no bucket privado
-- "media" (users/<id>/...) e abre por link temporário.
-- =====================================================================

alter table public.profiles
  add column if not exists phone text,
  add column if not exists photo_path text;

create or replace function public.update_my_profile(p_full_name text, p_phone text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_name text := nullif(btrim(coalesce(p_full_name, '')), '');
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Informe o seu nome.';
  end if;
  if length(v_name) > 120 then
    raise exception 'O nome passa de 120 caracteres.';
  end if;
  if v_phone is not null and length(v_phone) not between 10 and 15 then
    raise exception 'Informe o telefone com DDD.';
  end if;
  update public.profiles set full_name = v_name, phone = v_phone where id = auth.uid();
end;
$$;
revoke all on function public.update_my_profile(text, text) from public, anon;
grant execute on function public.update_my_profile(text, text) to authenticated;

-- foto do próprio perfil (p_path null = tirar)
create or replace function public.set_my_photo(p_path text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_path is not null and p_path not like 'users/' || auth.uid()::text || '/%' then
    raise exception 'Arquivo inválido.';
  end if;
  update public.profiles set photo_path = p_path where id = auth.uid();
end;
$$;
revoke all on function public.set_my_photo(text) from public, anon;
grant execute on function public.set_my_photo(text) to authenticated;
