-- =====================================================================
-- Foto de perfil em tamanho grande, para ampliar ao clicar (como no
-- WhatsApp). O worker guarda as duas versões: a pequena para as listas e a
-- grande para a visualização ampliada. Fotos já guardadas sem a versão
-- grande são buscadas de novo automaticamente.
-- =====================================================================

alter table public.contact_avatars
  add column if not exists full_path text;
