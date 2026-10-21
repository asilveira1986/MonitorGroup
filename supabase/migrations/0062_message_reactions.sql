-- =====================================================================
-- Reações nas mensagens (👍 ❤️ 😂 ...).
--
-- O worker guarda cada reação recebida no WhatsApp: uma por pessoa por
-- mensagem (trocar o emoji substitui; tirar a reação apaga). Reação não é
-- mensagem: não abre pendência, não conta no tempo de resposta e não gera
-- aviso. Aparece na conversa, embaixo da mensagem.
-- =====================================================================

create table if not exists public.message_reactions (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  group_id       uuid not null references public.groups(id) on delete cascade,
  message_id     uuid not null references public.messages(id) on delete cascade,
  reactor_jid    text not null,
  reactor_phone  text,
  reactor_name   text,
  from_team      boolean not null default false,
  team_member_id uuid references public.team_members(id) on delete set null,
  emoji          text not null,
  reacted_at     timestamptz not null default now(),
  unique (message_id, reactor_jid)
);
create index if not exists message_reactions_group_idx on public.message_reactions (group_id, reacted_at desc);

alter table public.message_reactions enable row level security;
drop policy if exists message_reactions_read on public.message_reactions;
create policy message_reactions_read on public.message_reactions for select
  using (group_id in (select unnest(public.visible_group_ids())));
grant select on public.message_reactions to authenticated;

-- a conversa aberta atualiza sozinha (inclusive quando a reação é retirada)
alter table public.message_reactions replica identity full;
do $$
begin
  begin alter publication supabase_realtime add table public.message_reactions; exception when others then null; end;
end $$;
