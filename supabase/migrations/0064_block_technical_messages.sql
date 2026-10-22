-- =====================================================================
-- "secretEncrypted" e outros pacotes técnicos do WhatsApp: barrados no banco.
--
-- O worker atualizado já ignora esses pacotes (0048), mas um worker em
-- versão antiga (ou a importação do histórico) ainda podia gravá-los: eles
-- apareciam na conversa como "secretEncrypted" e contavam como mensagem do
-- cliente. Agora o próprio banco descarta esses tipos ao gravar (qualquer
-- versão do worker) e apaga os que já entraram, recalculando os grupos.
-- =====================================================================

create or replace function public.is_technical_message_type(p_type text)
returns boolean
language sql immutable
as $$
  select p_type in (
    'secretEncrypted', 'encEventResponse', 'encComment', 'encReaction', 'pollResultSnapshot',
    'placeholder', 'statusMention', 'protocol', 'reaction', 'senderKeyDistribution',
    'messageContextInfo', 'pollUpdate', 'keepInChat', 'pinInChat'
  )
$$;

-- descarta ao gravar (ingest_message devolve "não inserida"; o histórico pula a linha)
create or replace function public.skip_technical_message()
returns trigger
language plpgsql
as $$
begin
  if public.is_technical_message_type(new.message_type) then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_skip_technical on public.messages;
create trigger messages_skip_technical before insert on public.messages
  for each row execute function public.skip_technical_message();

-- apaga os que já entraram e recalcula as empresas afetadas (pendência só diminui)
do $$
declare
  v_company uuid;
  v_n int;
begin
  create temp table _tech_groups on commit drop as
    select distinct m.group_id from public.messages m where public.is_technical_message_type(m.message_type);
  delete from public.messages where public.is_technical_message_type(message_type);
  get diagnostics v_n = row_count;
  raise notice 'Mensagens técnicas apagadas: %', v_n;
  for v_company in
    select distinct g.company_id from public.groups g join _tech_groups t on t.group_id = g.id
  loop
    perform public.recalc_company_groups(v_company);
  end loop;
end $$;
