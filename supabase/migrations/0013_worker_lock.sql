-- =====================================================================
-- Um único worker por vez usa o WhatsApp.
--
-- Duas cópias do worker com a mesma sessão (2 réplicas no Railway, a
-- sobreposição de um deploy ou um worker rodando no computador de
-- alguém com as mesmas variáveis) fazem o WhatsApp derrubar as duas
-- conexões ("428 Connection Terminated" / "Sessão aberta em outro local").
-- A trava abaixo garante que só quem a detém se conecta; a outra cópia
-- fica aguardando e aparece no painel.
-- =====================================================================

create table if not exists public.worker_lock (
  id           text primary key default 'whatsapp',
  holder       text not null,
  host         text,
  acquired_at  timestamptz not null default now(),
  expires_at   timestamptz not null
);

alter table public.worker_lock enable row level security;
drop policy if exists worker_lock_read on public.worker_lock;
create policy worker_lock_read on public.worker_lock for select using (public.is_active_user());

-- pega ou renova a trava; devolve quem está com ela
create or replace function public.acquire_worker_lock(p_holder text, p_host text, p_ttl_seconds int default 45)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  r public.worker_lock;
begin
  insert into public.worker_lock as l (id, holder, host, acquired_at, expires_at)
  values ('whatsapp', p_holder, p_host, now(), now() + make_interval(secs => p_ttl_seconds))
  on conflict (id) do update
    set holder = excluded.holder,
        host = excluded.host,
        acquired_at = case when l.holder = excluded.holder then l.acquired_at else now() end,
        expires_at = excluded.expires_at
    where l.holder = excluded.holder or l.expires_at < now();

  select * into r from public.worker_lock where id = 'whatsapp';
  return jsonb_build_object(
    'acquired', r.holder = p_holder,
    'holder', r.holder,
    'host', r.host,
    'expires_at', r.expires_at
  );
end;
$$;

create or replace function public.release_worker_lock(p_holder text)
returns void
language sql security definer set search_path = public
as $$
  delete from public.worker_lock where id = 'whatsapp' and holder = p_holder;
$$;

revoke all on function public.acquire_worker_lock(text, text, int) from public, anon, authenticated;
revoke all on function public.release_worker_lock(text) from public, anon, authenticated;
grant execute on function public.acquire_worker_lock(text, text, int) to service_role;
grant execute on function public.release_worker_lock(text) to service_role;

-- atualiza o cache da API do Supabase (evita "Could not find the ... column in the schema cache")
notify pgrst, 'reload schema';
