-- =====================================================================
-- Recuperar mensagens antigas de um grupo (recurso experimental).
--
-- Grupos que ficaram sem monitoramento (antes da 0157) não guardaram o que
-- chegou nesse intervalo. O administrador pede, na conversa do grupo, para
-- recuperar os últimos N dias: o worker pergunta ao celular conectado, em
-- páginas de 50 mensagens (histórico sob demanda do WhatsApp), a partir da
-- mensagem mais recente guardada, e grava o que faltava como HISTÓRICO
-- (não abre pendência, não gera alerta nem aciona automação).
--
--  * history_requests: um pedido por vez em cada grupo, com o andamento
--    (pedidos feitos, mensagens vistas e novas, até onde chegou) e o motivo
--    de ter parado.
--  * request_history_recovery / cancel_history_recovery: só administradores.
--  * O worker (chave de serviço) escreve o andamento.
-- =====================================================================

create table if not exists public.history_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  group_id       uuid not null references public.groups(id) on delete cascade,
  requested_by   uuid default auth.uid(),
  days           int not null check (days between 1 and 30),
  since          timestamptz not null,
  status         text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  requests_sent  int not null default 0,
  messages_found int not null default 0,
  messages_added int not null default 0,
  oldest_at      timestamptz,
  note           text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz not null default now()
);
-- um pedido aberto por grupo
create unique index if not exists history_requests_open_idx on public.history_requests (group_id) where status in ('pending', 'running');
create index if not exists history_requests_group_idx on public.history_requests (group_id, created_at desc);

alter table public.history_requests enable row level security;
drop policy if exists history_requests_read on public.history_requests;
create policy history_requests_read on public.history_requests for select
  using ((select public.is_admin()) and company_id = (select public.current_company_id()));
grant select on public.history_requests to authenticated;

create or replace function public.request_history_recovery(p_group_id uuid, p_days int)
returns public.history_requests
language plpgsql security definer set search_path = public as $$
declare
  v_group public.groups%rowtype;
  v_row   public.history_requests;
begin
  if not public.is_admin() then
    raise exception 'Só administradores recuperam mensagens antigas.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Escolha um período de 1 a 30 dias.';
  end if;
  select * into v_group from public.groups where id = p_group_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Grupo não encontrado.';
  end if;
  if v_group.removed_at is not null then
    raise exception 'O número conectado não participa mais deste grupo.';
  end if;
  begin
    insert into public.history_requests (company_id, group_id, days, since)
    values (v_group.company_id, v_group.id, p_days, now() - make_interval(days => p_days))
    returning * into v_row;
  exception when unique_violation then
    raise exception 'Já existe uma recuperação em andamento neste grupo.';
  end;
  return v_row;
end;
$$;
revoke all on function public.request_history_recovery(uuid, int) from public, anon;
grant execute on function public.request_history_recovery(uuid, int) to authenticated;

create or replace function public.cancel_history_recovery(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Só administradores cancelam a recuperação.' using errcode = '42501';
  end if;
  update public.history_requests
     set status = 'cancelled', finished_at = now(), updated_at = now(), note = coalesce(note, 'Cancelado por um administrador.')
   where id = p_id and company_id = public.current_company_id() and status in ('pending', 'running');
end;
$$;
revoke all on function public.cancel_history_recovery(uuid) from public, anon;
grant execute on function public.cancel_history_recovery(uuid) to authenticated;
