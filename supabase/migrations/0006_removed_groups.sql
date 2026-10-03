-- =====================================================================
-- Grupos excluídos do WhatsApp.
--
-- Quando o número conectado sai/é removido de um grupo, ou o grupo é
-- apagado no celular, o worker marca o grupo como "excluído" (removed_at).
-- Ele sai das listas ativas, da fila de pendências e dos alertas, mas o
-- histórico continua disponível na aba "Excluídos". De lá o administrador
-- pode excluí-lo definitivamente. Se o número voltar ao grupo, ele é
-- reativado automaticamente.
-- =====================================================================

alter table public.groups add column if not exists removed_at timestamptz;
alter table public.groups add column if not exists removed_reason text;

create index if not exists groups_removed_idx on public.groups (removed_at) where removed_at is not null;

-- Marca o grupo como excluído do WhatsApp (usado pelo worker)
create or replace function public.mark_group_removed(p_group_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.groups set
    removed_at = coalesce(removed_at, now()),
    removed_reason = p_reason,
    pending_since = null,
    pending_message_id = null,
    pending_count = 0
  where id = p_group_id;

  -- ninguém mais consegue responder nesse grupo: encerra os alertas abertos
  update public.alerts set status = 'resolved', resolved_at = now()
   where group_id = p_group_id and status <> 'resolved';
end;
$$;

revoke all on function public.mark_group_removed(uuid, text) from public, anon, authenticated;
grant execute on function public.mark_group_removed(uuid, text) to service_role;

-- Exclusão definitiva (somente administradores e somente grupos já
-- excluídos do WhatsApp). Apaga mensagens e alertas em cascata.
create or replace function public.delete_removed_groups(p_group_ids uuid[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_count int;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores podem excluir grupos';
  end if;

  delete from public.groups where id = any(p_group_ids) and removed_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.delete_removed_groups(uuid[]) to authenticated;

-- Fila de pendências ignora grupos excluídos
create or replace view public.pending_queue
with (security_invoker = true)
as
select
  g.id,
  g.name,
  g.instance_id,
  g.pending_since,
  g.pending_count,
  g.last_message_preview,
  g.last_message_at,
  coalesce(g.sla_minutes, s.default_sla_minutes) as sla_minutes,
  extract(epoch from (now() - g.pending_since))::int as waiting_seconds,
  (now() - g.pending_since) > make_interval(mins => coalesce(g.sla_minutes, s.default_sla_minutes)) as overdue,
  pm.sender_name as pending_sender_name,
  pm.sender_phone as pending_sender_phone,
  pm.body as pending_body
from public.groups g
cross join public.app_settings s
left join public.messages pm on pm.id = g.pending_message_id
where g.monitored and g.removed_at is null and g.pending_since is not null
order by g.pending_since asc;

grant select on public.pending_queue to authenticated;
