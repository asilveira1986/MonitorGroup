-- =====================================================================
-- Recuperar mensagens antigas de TODAS as conversas privadas de uma vez, só para o
-- administrador geral da plataforma (recurso experimental, como o dos grupos, 0161).
--
--  * private_history_requests.batch_id: liga os pedidos feitos juntos.
--  * request_private_history_recovery_all: um pedido por conversa da empresa (as em aberto,
--    ou todas); conversas que já têm pedido aberto ficam de fora (contadas em skipped). O
--    worker faz um de cada vez, da conversa mais recente para a mais antiga.
--  * private_history_recovery_batch_status / cancel_private_history_recovery_batch: andamento
--    do lote mais recente e cancelamento do que ainda não terminou (mesmo formato dos grupos).
-- =====================================================================

alter table public.private_history_requests add column if not exists batch_id uuid;
create index if not exists private_history_requests_batch_idx on public.private_history_requests (company_id, batch_id) where batch_id is not null;

create or replace function public.request_private_history_recovery_all(p_days int, p_only_open boolean default true)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_batch    uuid := gen_random_uuid();
  v_created  int;
  v_eligible int;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma recupera as mensagens de todas as conversas.' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Escolha um período de 1 a 30 dias.';
  end if;
  select count(*) into v_eligible from public.private_chats c
   where c.company_id = public.current_company_id()
     and (not coalesce(p_only_open, true) or c.closed_at is null);
  insert into public.private_history_requests (company_id, chat_id, days, since, batch_id)
  select c.company_id, c.id, p_days, now() - make_interval(days => p_days), v_batch
    from public.private_chats c
   where c.company_id = public.current_company_id()
     and (not coalesce(p_only_open, true) or c.closed_at is null)
     and not exists (select 1 from public.private_history_requests h where h.chat_id = c.id and h.status in ('pending', 'running'))
   order by c.last_message_at desc nulls last;
  get diagnostics v_created = row_count;
  return jsonb_build_object('batch_id', v_batch, 'created', v_created, 'skipped', v_eligible - v_created);
end;
$$;
revoke all on function public.request_private_history_recovery_all(int, boolean) from public, anon;
grant execute on function public.request_private_history_recovery_all(int, boolean) to authenticated;

-- andamento do lote mais recente da empresa (null = nunca houve); mesmo formato do dos grupos
create or replace function public.private_history_recovery_batch_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_batch uuid;
  v_out   jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma vê o andamento da recuperação em todas as conversas.' using errcode = '42501';
  end if;
  select batch_id into v_batch from public.private_history_requests
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
      from (select note, count(*) c from public.private_history_requests
             where batch_id = v_batch and status = 'failed' group by note order by count(*) desc limit 5) n)
  ) into v_out
  from public.private_history_requests where batch_id = v_batch;
  return v_out;
end;
$$;
revoke all on function public.private_history_recovery_batch_status() from public, anon;
grant execute on function public.private_history_recovery_batch_status() to authenticated;

create or replace function public.cancel_private_history_recovery_batch(p_batch uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not public.is_platform_admin() then
    raise exception 'Só quem administra a plataforma cancela a recuperação em todas as conversas.' using errcode = '42501';
  end if;
  update public.private_history_requests
     set status = 'cancelled', finished_at = now(), updated_at = now(), note = coalesce(note, 'Cancelado por um administrador.')
   where batch_id = p_batch and company_id = public.current_company_id() and status in ('pending', 'running');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cancel_private_history_recovery_batch(uuid) from public, anon;
grant execute on function public.cancel_private_history_recovery_batch(uuid) to authenticated;
