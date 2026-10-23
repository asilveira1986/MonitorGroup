-- =====================================================================
-- Respostas citando uma mensagem (como no WhatsApp) nos grupos.
--
-- O worker guarda qual mensagem foi respondida (id do WhatsApp), quem a
-- escreveu e um trecho dela; a conversa mostra o quadro da citação acima
-- da resposta (também quando a original é antiga e não está carregada).
-- =====================================================================

alter table public.messages
  add column if not exists quoted_wa_id text,
  add column if not exists quoted_sender_jid text,
  add column if not exists quoted_body text,
  add column if not exists quoted_type text;
