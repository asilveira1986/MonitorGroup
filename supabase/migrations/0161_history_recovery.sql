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
--  * request_history_recovery_all (+ _batch_status e cancel_..._batch): o administrador geral da
--    plataforma pede a recuperação de TODOS os grupos ativos da empresa de uma vez (um pedido por
--    grupo, ligados pelo batch_id), acompanha o conjunto e cancela tudo.
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
  batch_id       uuid,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  updated_at     timestamptz not null default now()
);
-- um pedido aberto por grupo
create unique index if not exists history_requests_open_idx on public.history_requests (group_id) where status in ('pending', 'running');
create index if not exists history_requests_group_idx on public.history_requests (group_id, created_at desc);
alter table public.history_requests add column if not exists batch_id uuid;
create index if not exists history_requests_batch_idx on public.history_requests (company_id, batch_id) where batch_id is not null;

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

-- ------------------------------------------------ todos os grupos (administrador geral da plataforma)
-- Um pedido por grupo ativo da empresa em que o administrador está, ligados por um mesmo batch_id.
-- Grupos que já têm pedido aberto ficam de fora (contados em skipped). p_only_unmonitored: só os sem monitoramento.
create or replace function public.request_history_recovery_all(p_days int, p_only_unmonitored boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch   uuid := gen_random_uuid();
  v_created int;
  v_eligible int;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma recupera as mensagens de todos os grupos.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Escolha um período de 1 a 30 dias.';
  end if;
  select count(*) into v_eligible from public.groups g
   where g.company_id = public.current_company_id() and g.removed_at is null
     and (not coalesce(p_only_unmonitored, false) or not g.monitored);
  insert into public.history_requests (company_id, group_id, days, since, batch_id)
  select g.company_id, g.id, p_days, now() - make_interval(days => p_days), v_batch
    from public.groups g
   where g.company_id = public.current_company_id() and g.removed_at is null
     and (not coalesce(p_only_unmonitored, false) or not g.monitored)
     and not exists (select 1 from public.history_requests h where h.group_id = g.id and h.status in ('pending', 'running'))
   order by g.last_message_at desc nulls last;
  get diagnostics v_created = row_count;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'skipped', v_eligible - v_created);
end;
$$;
revoke all on function public.request_history_recovery_all(int, boolean) from public, anon;
grant execute on function public.request_history_recovery_all(int, boolean) to authenticated;

-- andamento do pedido em lote mais recente da empresa (null = nunca houve)
create or replace function public.history_recovery_batch_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_batch uuid;
  v_out   jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma vê o andamento da recuperação em todos os grupos.' using errcode = '42501';
  end if;
  select batch_id into v_batch from public.history_requests
   where company_id = public.current_company_id() and batch_id is not null
   order by created_at desc limit 1;
  if v_batch is null then
    return null;
  end if;
  select jsonb_build_object(
    'batch_id', v_batch,
    'days', max(days),
    'created_at', min(created_at),
    'total', count(*),
    'pending', count(*) filter (where status = 'pending'),
    'running', count(*) filter (where status = 'running'),
    'done', count(*) filter (where status = 'done'),
    'failed', count(*) filter (where status = 'failed'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'added', coalesce(sum(messages_added), 0),
    'found', coalesce(sum(messages_found), 0),
    'groups_with_news', count(*) filter (where messages_added > 0),
    'failed_notes', (
      select coalesce(jsonb_agg(jsonb_build_object('note', n.note, 'n', n.c) order by n.c desc), '[]'::jsonb)
      from (select note, count(*) c from public.history_requests
             where batch_id = v_batch and status = 'failed' group by note order by count(*) desc limit 5) n)
  ) into v_out
  from public.history_requests where batch_id = v_batch;
  return v_out;
end;
$$;
revoke all on function public.history_recovery_batch_status() from public, anon;
grant execute on function public.history_recovery_batch_status() to authenticated;

create or replace function public.cancel_history_recovery_batch(p_batch uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma cancela a recuperação em todos os grupos.' using errcode = '42501';
  end if;
  update public.history_requests
     set status = 'cancelled', finished_at = now(), updated_at = now(), note = coalesce(note, 'Cancelado por um administrador.')
   where batch_id = p_batch and company_id = public.current_company_id() and status in ('pending', 'running');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cancel_history_recovery_batch(uuid) from public, anon;
grant execute on function public.cancel_history_recovery_batch(uuid) to authenticated;
