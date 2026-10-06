-- =====================================================================
-- Configuração do alerta de nova mensagem (Configurações › Geral)
--  * msg_alert_enabled:    mostra o alerta no centro da tela;
--  * msg_alert_auto_close: 0 = fica na tela até alguém fechar;
--                          senão, fecha sozinho depois destes segundos;
--  * msg_alert_sound:      toca o bipe junto com o alerta.
-- Cada pessoa ainda pode silenciar o alerta no próprio navegador (sino do topo).
-- =====================================================================

alter table public.app_settings
  add column if not exists msg_alert_enabled boolean not null default true,
  add column if not exists msg_alert_auto_close int not null default 0,
  add column if not exists msg_alert_sound boolean not null default true;

alter table public.app_settings drop constraint if exists app_settings_msg_alert_auto_close_check;
alter table public.app_settings add constraint app_settings_msg_alert_auto_close_check
  check (msg_alert_auto_close between 0 and 600);

notify pgrst, 'reload schema';
