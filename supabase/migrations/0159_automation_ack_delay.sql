-- =====================================================================
-- Automação: espera antes do acuse de recebimento.
--
-- automation_rules.ack_delay_sec: segundos entre a mensagem do cliente e o
-- acuse no grupo dele (0 = na hora, como sempre). O aviso no grupo interno e
-- o alerta em tela continuam saindo na hora. Se a equipe responder durante a
-- espera, o acuse não é enviado. Máximo de 10 minutos.
-- =====================================================================

alter table public.automation_rules
  add column if not exists ack_delay_sec int not null default 0 check (ack_delay_sec >= 0 and ack_delay_sec <= 600);
