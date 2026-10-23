-- =====================================================================
-- Duração dos áudios (e vídeos): guardada ao receber/enviar, para a
-- conversa mostrar o tempo antes de começar a ouvir.
-- =====================================================================

alter table public.messages add column if not exists media_seconds int;
alter table public.private_messages add column if not exists media_seconds int;
