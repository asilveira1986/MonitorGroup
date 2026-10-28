-- =====================================================================
-- Assinatura no privado.
--
--  * Como nos grupos, a mensagem enviada pelo painel numa conversa
--    privada sai no WhatsApp com o nome de quem enviou em negrito na
--    primeira linha (ex.: *Ana Souza:*). No painel ela aparece sem a
--    assinatura, com o nome de quem enviou.
--  * Vale para texto e legenda de arquivo; mensagem encaminhada e áudio
--    não levam assinatura. Editar uma mensagem assinada mantém a
--    assinatura.
--  * Liga/desliga em Configurações › Atendimento › Responder pelo
--    sistema (começa ligado).
-- =====================================================================

alter table public.app_settings add column if not exists private_sign_name boolean not null default true;
-- o texto que sai no WhatsApp (com a assinatura); body continua sem, para o painel
alter table public.private_outgoing add column if not exists text_to_send text;
alter table public.private_actions add column if not exists text_to_send text;

create or replace function public.private_sign_text(p_company uuid, p_user uuid, p_body text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_user is null or nullif(btrim(coalesce(p_body, '')), '') is null then null
    when not coalesce((select private_sign_name from public.app_settings where company_id = p_company), true) then null
    else '*' || public.user_display_name(p_user) || ':*' || E'\n' || p_body
  end
$$;
revoke all on function public.private_sign_text(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.private_outgoing_sign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(new.forwarded, false) and coalesce(new.message_type, 'text') <> 'audio' then
    new.text_to_send := public.private_sign_text(new.company_id, new.created_by, new.body);
  end if;
  return new;
end;
$$;
drop trigger if exists private_outgoing_sign on public.private_outgoing;
create trigger private_outgoing_sign before insert on public.private_outgoing
  for each row execute function public.private_outgoing_sign();

-- editar uma mensagem que saiu assinada: o texto novo sai com a mesma assinatura
create or replace function public.private_actions_sign()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o public.private_outgoing%rowtype;
begin
  if new.action <> 'edit' then
    return new;
  end if;
  select q.* into o
    from public.private_messages m
    join public.private_outgoing q on q.chat_id = m.chat_id and q.wa_message_id = m.wa_message_id
   where m.id = new.message_id and q.text_to_send is not null
   limit 1;
  if o.id is not null then
    new.text_to_send := '*' || public.user_display_name(o.created_by) || ':*' || E'\n' || new.new_body;
  end if;
  return new;
end;
$$;
drop trigger if exists private_actions_sign on public.private_actions;
create trigger private_actions_sign before insert on public.private_actions
  for each row execute function public.private_actions_sign();
