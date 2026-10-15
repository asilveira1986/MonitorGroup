-- =====================================================================
-- Aviso por voz: o que é falado, voz, velocidade e tom
--
--  * msg_alert_voice_templates: frase de cada aviso, com itens
--    substituídos na hora ({grupo}, {remetente}, {mensagem}, {espera}...):
--    {"message": "...", "sla": "...", "alert": "..."}; vazio = frase padrão;
--  * msg_alert_voice_name: nome da voz escolhida (se não existir no
--    computador, usa a voz em português padrão dele);
--  * msg_alert_voice_rate / msg_alert_voice_pitch: velocidade e tom.
-- =====================================================================

alter table public.app_settings
  add column if not exists msg_alert_voice_templates jsonb not null default '{}'::jsonb,
  add column if not exists msg_alert_voice_name text,
  add column if not exists msg_alert_voice_rate numeric(3,2) not null default 1
    check (msg_alert_voice_rate between 0.5 and 2),
  add column if not exists msg_alert_voice_pitch numeric(3,2) not null default 1
    check (msg_alert_voice_pitch between 0 and 2);

notify pgrst, 'reload schema';
