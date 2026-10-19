-- =====================================================================
-- Foto de perfil em tamanho grande (coluna sem uso).
--
-- A visualização ampliada da foto foi retirada para o worker buscar só a
-- versão pequena (menos requisições ao WhatsApp). A coluna fica para não
-- quebrar bancos que já executaram este script.
-- =====================================================================

alter table public.contact_avatars
  add column if not exists full_path text;
