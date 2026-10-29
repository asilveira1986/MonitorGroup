-- 0123: troca de senha no primeiro acesso.
-- Quem entra com a senha inicial (cadastrada pelo administrador) ou com uma senha gerada por ele é
-- levado a definir a própria senha antes de usar o sistema. Usuários que já existiam não são afetados.

alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- o próprio usuário limpa a marca depois de trocar a senha
create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid() and must_change_password;
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;
