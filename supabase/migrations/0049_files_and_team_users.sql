-- =====================================================================
-- 1) Imagens, arquivos e vídeos disponíveis no sistema.
--    Vídeos e documentos passam a ser guardados por padrão (antes só imagens,
--    áudios e figurinhas) e o limite por arquivo sobe de 25 MB para 50 MB.
--    Empresas que estavam com a lista padrão antiga recebem a nova; quem já
--    escolheu os tipos em Configurações › Geral › Imagens e áudios fica como está.
-- 2) Membro da equipe com acesso ao sistema: guarda o e-mail do usuário
--    criado a partir da pessoa da equipe (Configurações › Equipe).
-- =====================================================================

alter table public.app_settings
  alter column media_store_types set default '{image,audio,sticker,video,document}';

update public.app_settings
   set media_store_types = '{image,audio,sticker,video,document}'
 where media_store_types = '{image,audio,sticker}';

update storage.buckets set file_size_limit = 52428800 where id = 'media';

alter table public.team_members
  add column if not exists user_email text;
