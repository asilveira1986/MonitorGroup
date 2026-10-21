-- =====================================================================
-- Retira o "Silenciar alertas por tipo" (0054): os avisos de todos os
-- tipos voltam ao normal. Apaga a tabela, as funções e a permissão
-- "Silenciar alertas" dos setores.
-- =====================================================================

drop function if exists public.set_alert_type_mute(text, timestamptz);
drop function if exists public.can_mute_alerts();
drop table if exists public.alert_type_mutes;
alter table public.sectors drop column if exists can_mute_alerts;
