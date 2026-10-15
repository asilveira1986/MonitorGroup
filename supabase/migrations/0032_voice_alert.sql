-- =====================================================================
-- Aviso por voz junto com o alerta em tela
--
-- Quando o aviso grande abre no centro da tela, o navegador também fala,
-- em português: "Nova mensagem no grupo Vendas SP, de Carla" ou
-- "Atenção: SLA excedido no grupo Vendas SP, sem resposta há 18 minutos".
--  * app_settings.msg_alert_voice: liga/desliga (padrão: ligado).
-- Cada usuário ainda silencia no próprio navegador pelo sino do topo.
-- =====================================================================

alter table public.app_settings
  add column if not exists msg_alert_voice boolean not null default true;

notify pgrst, 'reload schema';
