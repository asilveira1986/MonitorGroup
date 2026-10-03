-- =====================================================================
-- Sinal de vida do worker do WhatsApp, exibido no painel.
-- Permite saber se o worker está no ar e conectado ao banco.
-- =====================================================================

create table if not exists public.worker_status (
  id               text primary key default 'main',
  started_at       timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  version          text,
  whatsapp_version text,
  info             jsonb not null default '{}'
);

alter table public.worker_status enable row level security;

drop policy if exists worker_status_read on public.worker_status;
create policy worker_status_read on public.worker_status for select using (public.is_active_user());
