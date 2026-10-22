-- =====================================================================
-- Confirmação de entrega e leitura (os "tiques" do WhatsApp).
--
-- Para as mensagens enviadas pelo número conectado, o worker grava:
--  * messages.wa_status: 1 pendente, 2 enviada (✓), 3 entregue, 4 lida,
--    5 reproduzida (áudio) — o status geral que o WhatsApp informa;
--  * message_receipts: quem recebeu e quem leu, pessoa a pessoa.
-- Na conversa: ✓ enviada, ✓✓ cinza entregue a todos, ✓✓ azul lida por
-- todos, com "lida por X de N" e os nomes ao passar o mouse.
-- =====================================================================

alter table public.messages add column if not exists wa_status smallint;

create table if not exists public.message_receipts (
  message_id   uuid not null references public.messages(id) on delete cascade,
  company_id   uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_jid     text not null,
  delivered_at timestamptz,
  read_at      timestamptz,
  primary key (message_id, user_jid)
);
create index if not exists message_receipts_group_idx on public.message_receipts (group_id);

alter table public.message_receipts enable row level security;
drop policy if exists message_receipts_read on public.message_receipts;
create policy message_receipts_read on public.message_receipts for select
  using (group_id in (select unnest(public.visible_group_ids())));
grant select on public.message_receipts to authenticated;
do $$
begin
  begin alter publication supabase_realtime add table public.message_receipts; exception when others then null; end;
end $$;
