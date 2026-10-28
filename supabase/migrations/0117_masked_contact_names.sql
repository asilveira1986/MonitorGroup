-- =====================================================================
-- Nome dos contatos: número mascarado não é nome.
--
--  * Para alguns contatos (os que o WhatsApp identifica só pelo
--    identificador interno, o LID), ele manda como "nome salvo" o número
--    mascarado (ex.: +55∙∙∙∙∙∙∙11). Isso era guardado como o nome e
--    aparecia no lugar do nome da pessoa.
--  * Agora "nome" que é só número (mascarado ou não) é descartado: vale o
--    nome salvo na agenda quando o WhatsApp manda, senão o nome que a
--    pessoa usa no WhatsApp.
--  * Os nomes mascarados já gravados são apagados e as conversas
--    privadas recebem de novo o nome certo.
-- =====================================================================

-- o nome, ou null se for só número / número mascarado
create or replace function public.contact_real_name(p_name text)
returns text language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_name, '')), '') is null then null
    -- sem nenhuma letra e com cara de telefone (começa com + ou dígito e tem pelo menos 4 dígitos),
    -- mascarado com qualquer símbolo
    when p_name !~ '[[:alpha:]]' and btrim(p_name) ~ '^\+?[0-9]'
         and length(regexp_replace(p_name, '\D', '', 'g')) >= 4 then null
    else btrim(p_name)
  end
$$;

create or replace function public.wa_contacts_clean_names()
returns trigger language plpgsql as $$
begin
  new.name := public.contact_real_name(new.name);
  new.notify := public.contact_real_name(new.notify);
  return new;
end;
$$;
drop trigger if exists wa_contacts_clean_names on public.wa_contacts;
create trigger wa_contacts_clean_names before insert or update of name, notify on public.wa_contacts
  for each row execute function public.wa_contacts_clean_names();

-- limpa o que já foi gravado
update public.wa_contacts set name = null
 where name is not null and public.contact_real_name(name) is null;
update public.wa_contacts set notify = null
 where notify is not null and public.contact_real_name(notify) is null;
-- conversas com o número mascarado no lugar do nome: o nome certo volta pela agenda (abaixo) ou pela
-- próxima mensagem
update public.private_chats set name = null
 where name is not null and public.contact_real_name(name) is null and btrim(name) !~ '^[-+0-9 ()]+$';

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.whatsapp_instances loop
    perform public.link_wa_contacts(v_id);
  end loop;
end $$;
