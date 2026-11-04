-- =====================================================================
-- Mensagem apagada para todos: o texto não aparece mais em lugar nenhum do painel, como no WhatsApp.
--
--  * A lista de grupos mostrava como "última mensagem" o texto que foi apagado: passa a mostrar
--    "🚫 Mensagem apagada" (como a lista do privado, 0070).
--  * As respostas que citavam a mensagem apagada guardavam o texto citado: passa a valer o aviso.
--  * O texto original continua guardado em messages.body (indicadores e histórico); só deixa de
--    ser mostrado.
-- =====================================================================

create or replace function public.messages_deleted_scrub()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- era a última mensagem do grupo: a lista mostra o aviso no lugar do texto
  update public.groups
     set last_message_preview = '🚫 Mensagem apagada'
   where id = new.group_id and last_message_at = new.sent_at;
  -- respostas que citam a mensagem apagada
  update public.messages
     set quoted_body = '🚫 Mensagem apagada', quoted_type = null
   where group_id = new.group_id and quoted_wa_id = new.wa_message_id and quoted_body is distinct from '🚫 Mensagem apagada';
  return null;
end;
$$;
revoke all on function public.messages_deleted_scrub() from public, anon, authenticated;

drop trigger if exists messages_deleted_scrub on public.messages;
create trigger messages_deleted_scrub after update of deleted_at on public.messages
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.messages_deleted_scrub();

-- o que já foi apagado antes desta atualização
update public.groups g
   set last_message_preview = '🚫 Mensagem apagada'
 where g.last_message_at is not null
   and exists (select 1 from public.messages m where m.group_id = g.id and m.sent_at = g.last_message_at and m.deleted_at is not null);

update public.messages q
   set quoted_body = '🚫 Mensagem apagada', quoted_type = null
 where q.quoted_wa_id is not null and q.quoted_body is distinct from '🚫 Mensagem apagada'
   and exists (select 1 from public.messages m where m.group_id = q.group_id and m.wa_message_id = q.quoted_wa_id and m.deleted_at is not null);

notify pgrst, 'reload schema';
