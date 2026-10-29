-- =====================================================================
-- Avisos das conversas privadas com configuração própria.
--
--  * Configurações › Monitoramento › Avisos em tela e voz › Conversas
--    privadas (administradores):
--    - aviso das conversas que o usuário está atendendo;
--    - aviso das conversas aguardando atendimento (antes seguia o aviso
--      de mensagem nova dos grupos);
--    - som e voz próprios do privado.
--  * Tudo começa ligado. A notificação no celular continua em Meu perfil
--    (cada usuário).
-- =====================================================================

alter table public.app_settings
  add column if not exists private_alert_mine boolean not null default true,
  add column if not exists private_alert_queue boolean not null default true,
  add column if not exists private_alert_sound boolean not null default true,
  add column if not exists private_alert_voice boolean not null default true;
