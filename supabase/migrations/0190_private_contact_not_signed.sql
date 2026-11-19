-- =====================================================================
-- Contato enviado pela conversa privada chegava vazio no WhatsApp do cliente.
--
-- O gatilho de assinatura (0116) trocava text_to_send por "*Nome:*" + o texto
-- para todo tipo de mensagem, menos áudio. No contato (0182), text_to_send é o
-- cartão (vCard) pronto; sobrescrito, o cartão saía sem o telefone e o cliente
-- não conseguia usar o contato. Agora o contato também fica de fora da assinatura.
-- (O grupo não tem esse gatilho.)
-- =====================================================================

create or replace function public.private_outgoing_sign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(new.forwarded, false) and coalesce(new.message_type, 'text') not in ('audio', 'contact') then
    new.text_to_send := public.private_sign_text(new.company_id, new.created_by, new.body);
  end if;
  return new;
end;
$$;
