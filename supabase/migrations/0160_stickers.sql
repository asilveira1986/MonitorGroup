-- =====================================================================
-- Figurinhas: biblioteca da empresa e envio pelo painel.
--
--  * stickers: a biblioteca de figurinhas da empresa (arquivos .webp na pasta
--    <empresa>/stickers/ do Storage). Todos da empresa veem; quem pode responder
--    adiciona e marca favoritas; só administradores excluem.
--  * send_group_message (0147): aceita o tipo 'sticker'. O arquivo pode estar na
--    pasta do grupo (figurinha recebida nele) ou na biblioteca da empresa; até
--    1 MB; sem texto. O worker envia como figurinha de verdade.
-- =====================================================================

create table if not exists public.stickers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  media_path  text not null,
  media_size  bigint not null default 0 check (media_size >= 0),
  name        text,
  favorite    boolean not null default false,
  source      text not null default 'upload' check (source in ('upload', 'received')),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (company_id, media_path),
  check (media_path like company_id::text || '/stickers/%')
);
create index if not exists stickers_company_idx on public.stickers (company_id, favorite desc, created_at desc);

alter table public.stickers enable row level security;
drop policy if exists stickers_read on public.stickers;
create policy stickers_read on public.stickers for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
drop policy if exists stickers_insert on public.stickers;
create policy stickers_insert on public.stickers for insert
  with check ((select public.is_active_user()) and (select public.can_write()) and company_id = (select public.current_company_id()));
drop policy if exists stickers_update on public.stickers;
create policy stickers_update on public.stickers for update
  using ((select public.is_active_user()) and (select public.can_write()) and company_id = (select public.current_company_id()))
  with check (company_id = (select public.current_company_id()));
drop policy if exists stickers_delete on public.stickers;
create policy stickers_delete on public.stickers for delete
  using ((select public.is_admin()) and company_id = (select public.current_company_id()));
grant select, insert, update, delete on public.stickers to authenticated;

create or replace function public.send_group_message(
  p_group_id uuid, p_body text, p_quoted_message_id uuid default null, p_closes boolean default false, p_media jsonb default null,
  p_mentions text[] default null
)
returns public.outgoing_messages
language plpgsql security definer set search_path = public
as $$
declare
  v_settings public.app_settings%rowtype;
  v_group    public.groups%rowtype;
  v_name     text;
  v_body     text := btrim(coalesce(p_body, ''));
  v_path     text;
  v_type     text := 'text';
  v_row      public.outgoing_messages;
  v_mentions text[] := coalesce(p_mentions, '{}');
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_settings from public.app_settings
   where company_id = (select company_id from public.groups where id = p_group_id);
  if not v_settings.reply_enabled then
    raise exception 'Responder pelo sistema está desligado. Um administrador pode ativar em Configurações › Geral.';
  end if;
  if v_settings.reply_allowed = 'admin' and not public.is_admin() then
    raise exception 'Só administradores podem responder pelo sistema.' using errcode = '42501';
  end if;

  select * into v_group from public.groups where id = p_group_id;
  if not found then
    raise exception 'Grupo não encontrado.';
  end if;
  if p_media is not null then
    v_path := p_media->>'path';
    v_type := coalesce(nullif(p_media->>'type', ''),
                       case when coalesce(p_media->>'mime', '') like 'audio/%' then 'audio' else 'document' end);
    if v_type not in ('image', 'video', 'audio', 'document', 'sticker') then
      raise exception 'Tipo de arquivo inválido.';
    end if;
    -- o arquivo precisa estar na pasta deste grupo (figurinha: ou na biblioteca de figurinhas da empresa)
    if v_path is null or not (v_path like v_group.company_id::text || '/' || v_group.id::text || '/%'
                              or (v_type = 'sticker' and v_path like v_group.company_id::text || '/stickers/%')) then
      raise exception 'Arquivo inválido.';
    end if;
    if v_type = 'sticker' then
      if coalesce((p_media->>'size')::bigint, 0) > 1024 * 1024 then
        raise exception 'A figurinha passa de 1 MB.';
      end if;
      v_body := '';
    elsif v_type = 'audio' then
      if coalesce((p_media->>'size')::bigint, 0) > 16 * 1024 * 1024 then
        raise exception 'O áudio passa de 16 MB.';
      end if;
      v_body := '';
    elsif coalesce((p_media->>'size')::bigint, 0) > 50 * 1024 * 1024 then
      raise exception 'O arquivo passa de 50 MB.';
    end if;
  elsif v_body = '' then
    raise exception 'Escreva a mensagem.';
  end if;
  if length(v_body) > 4000 then
    raise exception 'A mensagem passa de 4000 caracteres.';
  end if;
  if cardinality(v_mentions) > 50 then
    raise exception 'Marque no máximo 50 pessoas numa mensagem.';
  end if;
  if exists (select 1 from unnest(v_mentions) j where j !~ '^[0-9]{5,20}@(s\.whatsapp\.net|lid)$') then
    raise exception 'Menção inválida.';
  end if;
  if v_group.removed_at is not null then
    raise exception 'O número conectado não participa mais deste grupo.';
  end if;
  if not v_group.monitored then
    raise exception 'Ative o monitoramento do grupo para responder por aqui.';
  end if;
  if p_quoted_message_id is not null
     and not exists (select 1 from public.messages where id = p_quoted_message_id and group_id = p_group_id) then
    raise exception 'Mensagem citada não pertence a este grupo.';
  end if;

  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name
  from public.profiles where id = auth.uid();

  insert into public.outgoing_messages
    (group_id, instance_id, body, text_to_send, quoted_message_id, sender_name, created_by, closes_conversation,
     message_type, media_path, media_mime, media_size, media_name, voice, mentions)
  values
    (p_group_id, v_group.instance_id, v_body,
     case when v_type = 'audio' or (v_path is not null and v_body = '') then ''
          when v_settings.reply_sign_name then '*' || v_name || ':*' || E'\n' || v_body
          else v_body end,
     p_quoted_message_id, v_name, auth.uid(), coalesce(p_closes, false),
     v_type, v_path, p_media->>'mime', (p_media->>'size')::bigint, left(p_media->>'name', 200),
     v_type = 'audio' and coalesce((p_media->>'voice')::boolean, false), v_mentions)
  returning * into v_row;
  return v_row;
end;
$$;
