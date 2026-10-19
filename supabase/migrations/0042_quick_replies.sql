-- =====================================================================
-- Mensagens rápidas.
--
-- Textos prontos da empresa para responder pelo sistema: na caixa de
-- resposta da conversa, digite \ e o atalho (ex.: \boleto) para inserir.
-- Aceitam itens trocados na hora: {cliente}, {grupo}, {atendente},
-- {saudacao} (bom dia / boa tarde / boa noite).
-- Cadastro em Configurações › Mensagens rápidas (administradores).
-- =====================================================================

create table if not exists public.quick_replies (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  shortcut   text not null check (shortcut ~ '^[a-z0-9_-]{1,30}$'),
  title      text,
  body       text not null check (length(trim(body)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists quick_replies_company_shortcut_idx on public.quick_replies (company_id, shortcut);

alter table public.quick_replies enable row level security;

drop policy if exists quick_replies_read on public.quick_replies;
create policy quick_replies_read on public.quick_replies for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));

drop policy if exists quick_replies_admin on public.quick_replies;
create policy quick_replies_admin on public.quick_replies for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

grant select, insert, update, delete on public.quick_replies to authenticated;
