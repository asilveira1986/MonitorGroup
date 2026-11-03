-- =====================================================================
-- Contato compartilhado (cartão de contato) no grupo e no privado: o painel guarda o nome e o
-- telefone de cada contato para poder clicar nele e iniciar uma conversa privada.
--
--  * messages.contact_cards / private_messages.contact_cards: [{ "name": "...", "phone": "5511999998888" }].
--  * O worker preenche ao receber a mensagem. Cartões recebidos antes desta atualização não têm o
--    telefone guardado: aparecem só com o nome, sem o botão.
-- =====================================================================

alter table public.messages add column if not exists contact_cards jsonb;
alter table public.private_messages add column if not exists contact_cards jsonb;

notify pgrst, 'reload schema';
