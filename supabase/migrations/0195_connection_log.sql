-- =====================================================================
-- Histórico de desconexões dos números de WhatsApp (Configurações › WhatsApp).
--
--  * whatsapp_connection_log: um registro por período fora do ar (do momento em que o número deixou de estar conectado até
--    voltar a conectar; ended_at vazio = ainda desconectado), com o motivo informado pela conexão.
--  * um gatilho em whatsapp_instances abre e fecha os períodos sozinho a cada mudança de situação: vale para qualquer caminho
--    do worker (queda, reconexão, sessão encerrada no celular, QR expirado, reinício do serviço).
--  * quando o worker reinicia com o número marcado como conectado (ficou fora sem avisar), o período começa na última
--    atividade registrada (last_seen_at), não na hora em que o serviço voltou.
--  * só administradores leem (da própria empresa; o administrador da plataforma lê todas).
-- =====================================================================

create table if not exists public.whatsapp_connection_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies(id) on delete cascade,
  instance_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  reason      text,
  created_at  timestamptz not null default now()
);
create index if not exists whatsapp_connection_log_instance_idx on public.whatsapp_connection_log (instance_id, started_at desc);
create index if not exists whatsapp_connection_log_open_idx on public.whatsapp_connection_log (instance_id) where ended_at is null;

alter table public.whatsapp_connection_log enable row level security;
drop policy if exists connection_log_read on public.whatsapp_connection_log;
create policy connection_log_read on public.whatsapp_connection_log for select
  using ((select public.is_admin()) and (company_id = (select public.current_company_id()) or (select public.is_platform_admin())));

create or replace function public.whatsapp_connection_log_track()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is not distinct from old.status then
    -- sem mudança de situação, mas já fora do ar: guarda o motivo mais recente
    if new.status <> 'connected' and new.last_error is not null and new.last_error is distinct from old.last_error then
      update public.whatsapp_connection_log set reason = new.last_error where instance_id = new.id and ended_at is null;
    end if;
    return new;
  end if;
  if new.status = 'connected' then
    -- voltou: fecha o período aberto
    update public.whatsapp_connection_log set ended_at = now() where instance_id = new.id and ended_at is null;
  elsif old.status = 'connected' then
    -- caiu: abre um período (se o serviço ficou parado, começa na última atividade registrada)
    insert into public.whatsapp_connection_log (company_id, instance_id, started_at, reason)
    values (
      new.company_id,
      new.id,
      case when old.last_seen_at is not null and old.last_seen_at < now() - interval '3 minutes' then old.last_seen_at else now() end,
      new.last_error
    );
  elsif new.last_error is not null then
    update public.whatsapp_connection_log set reason = new.last_error where instance_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;

drop trigger if exists whatsapp_connection_log_track on public.whatsapp_instances;
create trigger whatsapp_connection_log_track after update of status, last_error on public.whatsapp_instances
  for each row execute function public.whatsapp_connection_log_track();

notify pgrst, 'reload schema';
