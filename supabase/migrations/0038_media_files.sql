-- =====================================================================
-- Ver imagens e áudios pelo sistema.
--
-- O worker baixa do WhatsApp as imagens, áudios (e, se a empresa quiser,
-- figurinhas, vídeos e documentos) das mensagens novas dos grupos
-- monitorados e guarda no Storage do Supabase, num bucket PRIVADO.
-- O painel abre cada arquivo por um link temporário, gerado no servidor só
-- para quem pode ver a mensagem (mesma regra de acesso das mensagens).
--
-- Configurações › Geral › Imagens e áudios: liga/desliga, quais tipos
-- guardar e por quantos dias (os mais antigos são apagados pelo worker).
-- =====================================================================

alter table public.app_settings
  add column if not exists media_store_enabled  boolean not null default true,
  add column if not exists media_store_types     text[]  not null default '{image,audio,sticker}',
  add column if not exists media_retention_days  int     not null default 90;

alter table public.messages
  add column if not exists media_path   text,   -- caminho no bucket "media"
  add column if not exists media_mime   text,
  add column if not exists media_size   int,
  add column if not exists media_status text;   -- stored | too_large | failed | expired

comment on column public.messages.media_status is
  'stored = arquivo guardado; too_large = acima do limite; failed = não foi possível baixar; expired = apagado pelo prazo';

-- arquivos a apagar pelo prazo (o worker procura por data)
create index if not exists messages_media_stored_idx on public.messages (sent_at)
  where media_path is not null;

-- bucket privado: ninguém acessa direto, só por link temporário gerado no servidor
insert into storage.buckets (id, name, public, file_size_limit)
values ('media', 'media', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Espaço usado pelos arquivos guardados da empresa (mostrado nas configurações)
create or replace function public.media_usage()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'files', count(*),
    'bytes', coalesce(sum(m.media_size), 0),
    'oldest', min(m.sent_at)
  )
  from public.messages m
  join public.groups g on g.id = m.group_id
  where m.media_path is not null and g.company_id = public.current_company_id() and public.is_active_user();
$$;

revoke all on function public.media_usage() from public, anon;
grant execute on function public.media_usage() to authenticated;
