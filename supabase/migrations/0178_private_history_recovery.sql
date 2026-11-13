-- =====================================================================
-- Recuperar mensagens antigas das CONVERSAS PRIVADAS, só para o administrador
-- geral da plataforma (recurso experimental, como o dos grupos, 0161).
--
--  * private_history_requests: um pedido por vez em cada conversa, com o
--    andamento (pedidos feitos, mensagens vistas e novas, até onde chegou).
--  * request_private_history_recovery / cancel_private_history_recovery: só
--    quem administra a plataforma. O worker (chave de serviço) faz o pedido
--    ao celular conectado e grava o andamento.
--  * A recuperação dos GRUPOS (0161) também passa a ser só do administrador
--    geral: o pedido, o cancelamento e a leitura do andamento.
-- =====================================================================

create table if not exists public.private_history_requests (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  chat_id        uuid not null references public.private_chats(id) on delete cascade,
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
create unique index if not exists private_history_requests_open_idx on public.private_history_requests (chat_id) where status in ('pending', 'running');
create index if not exists private_history_requests_chat_idx on public.private_history_requests (chat_id, created_at desc);

alter table public.private_history_requests enable row level security;
drop policy if exists private_history_requests_read on public.private_history_requests;
create policy private_history_requests_read on public.private_history_requests for select
  using ((select public.is_platform_admin()) and company_id = (select public.current_company_id()));
grant select on public.private_history_requests to authenticated;

create or replace function public.request_private_history_recovery(p_chat_id uuid, p_days int)
returns public.private_history_requests
language plpgsql security definer set search_path = public as $$
declare
  v_chat public.private_chats%rowtype;
  v_row  public.private_history_requests;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma recupera mensagens antigas.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Escolha um período de 1 a 30 dias.';
  end if;
  select * into v_chat from public.private_chats where id = p_chat_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Conversa não encontrada.';
  end if;
  begin
    insert into public.private_history_requests (company_id, chat_id, days, since)
    values (v_chat.company_id, v_chat.id, p_days, now() - make_interval(days => p_days))
    returning * into v_row;
  exception when unique_violation then
    raise exception 'Já existe uma recuperação em andamento nesta conversa.';
  end;
  return v_row;
end;
$$;
revoke all on function public.request_private_history_recovery(uuid, int) from public, anon;
grant execute on function public.request_private_history_recovery(uuid, int) to authenticated;

create or replace function public.cancel_private_history_recovery(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma cancela a recuperação.' using errcode = '42501';
  end if;
  update public.private_history_requests
     set status = 'cancelled', finished_at = now(), updated_at = now(), note = coalesce(note, 'Cancelado pelo administrador geral.')
   where id = p_id and company_id = public.current_company_id() and status in ('pending', 'running');
end;
$$;
revoke all on function public.cancel_private_history_recovery(uuid) from public, anon;
grant execute on function public.cancel_private_history_recovery(uuid) to authenticated;

-- ------------------------------------------------ grupos (0161): também só o administrador geral
do $$
begin
  if to_regprocedure('public.request_history_recovery(uuid,integer)') is not null then
    execute $f$
      create or replace function public.request_history_recovery(p_group_id uuid, p_days int)
      returns public.history_requests
      language plpgsql security definer set search_path = public as $b$
      declare
        v_group public.groups%rowtype;
        v_row   public.history_requests;
      begin
        if not public.is_platform_admin() then
          raise exception 'Só quem administra a plataforma recupera mensagens antigas.' using errcode = '42501';
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
      $b$
    $f$;
    execute $f$
      create or replace function public.cancel_history_recovery(p_id uuid)
      returns void
      language plpgsql security definer set search_path = public as $b$
      begin
        if not public.is_platform_admin() then
          raise exception 'Só quem administra a plataforma cancela a recuperação.' using errcode = '42501';
        end if;
        update public.history_requests
           set status = 'cancelled', finished_at = now(), updated_at = now(), note = coalesce(note, 'Cancelado pelo administrador geral.')
         where id = p_id and company_id = public.current_company_id() and status in ('pending', 'running');
      end;
      $b$
    $f$;
    drop policy if exists history_requests_read on public.history_requests;
    create policy history_requests_read on public.history_requests for select
      using ((select public.is_platform_admin()) and company_id = (select public.current_company_id()));
  end if;
end $$;
