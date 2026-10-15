-- =====================================================================
-- Aviso por voz configurado em Configurações › Regras de alerta
--
--  * app_settings.msg_alert_voice (0032): liga/desliga o aviso por voz;
--  * app_settings.msg_alert_voice_messages: fala as mensagens novas;
--  * app_settings.msg_alert_voice_sla: fala o SLA excedido;
--  * alert_rules.voice: cada regra de alerta escolhe se o alerta dela é falado.
-- Tudo ligado por padrão.
-- =====================================================================

alter table public.app_settings
  add column if not exists msg_alert_voice_messages boolean not null default true,
  add column if not exists msg_alert_voice_sla boolean not null default true;

alter table public.alert_rules
  add column if not exists voice boolean not null default true;

notify pgrst, 'reload schema';
