-- =====================================================================
-- Sincronizar os contatos do WhatsApp conectado sob demanda.
--
-- Botão "Sincronizar contatos" (Conversas privadas): o worker pede ao
-- WhatsApp o reenvio completo dos dados sincronizados (onde vem a agenda
-- com os nomes salvos) e completa com os membros de todos os grupos do
-- número. A situação fica na conexão (contacts_sync_status / _synced_at /
-- contacts_count).
-- =====================================================================

alter table public.whatsapp_instances drop constraint if exists whatsapp_instances_requested_action_check;
alter table public.whatsapp_instances add constraint whatsapp_instances_requested_action_check
  check (requested_action in ('connect', 'logout', 'reimport', 'sync_contacts'));

alter table public.whatsapp_instances
  add column if not exists contacts_sync_status text check (contacts_sync_status in ('syncing', 'done', 'failed')),
  add column if not exists contacts_synced_at timestamptz,
  add column if not exists contacts_count int;

create or replace function public.request_contacts_sync()
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_n int;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  update public.whatsapp_instances
     set requested_action = 'sync_contacts', contacts_sync_status = 'syncing'
   where company_id = public.current_company_id() and status = 'connected'
     and requested_action is null;
  get diagnostics v_n = row_count;
  if v_n = 0 and not exists (select 1 from public.whatsapp_instances
                              where company_id = public.current_company_id() and status = 'connected') then
    raise exception 'Nenhum WhatsApp conectado nesta empresa.';
  end if;
  return v_n;
end;
$$;
revoke all on function public.request_contacts_sync() from public, anon;
grant execute on function public.request_contacts_sync() to authenticated;
