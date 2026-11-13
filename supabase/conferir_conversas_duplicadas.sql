-- =====================================================================
-- Conversas privadas duplicadas: a mesma pessoa (mesmo número conectado e mesmo telefone)
-- com mais de uma conversa. É o que o script 0179 une. Só consulta (não altera nada):
-- rode ANTES do script para ver os casos, e depois dele para conferir que não sobrou nenhum.
-- Pré-requisito: a função private_phone_key (criada na 0179). Antes dela, use a versão simples abaixo.
-- =====================================================================

-- versão simples (só dígitos), funciona antes do script 0179
select i.name as numero_conectado,
       regexp_replace(c.phone, '[^0-9]', '', 'g') as telefone,
       count(*) as conversas,
       string_agg(coalesce(c.name, '(sem nome)') || ' [' || left(c.jid, 14) || '…]', ' | ') as conversas_encontradas,
       sum((select count(*) from public.private_messages m where m.chat_id = c.id)) as mensagens
from public.private_chats c
join public.whatsapp_instances i on i.id = c.instance_id
where c.phone is not null
group by i.name, regexp_replace(c.phone, '[^0-9]', '', 'g')
having count(*) > 1
order by conversas desc, mensagens desc;
