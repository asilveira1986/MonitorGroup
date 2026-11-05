-- =====================================================================
-- Automação de atendimento: chave geral da empresa (liga/desliga).
--
--  * app_settings.automation_enabled: a automação (acuse, alerta, aviso e cobrança) está ligada?
--    Começa DESLIGADA. Desligada, o worker não responde, não avisa nem cobra; as regras e as demandas
--    abertas ficam guardadas, e uma resposta da equipe no grupo ainda encerra a demanda aberta.
--  * Cada grupo continua com a sua regra (e o seu liga/desliga): a chave geral vale por cima.
-- =====================================================================

alter table public.app_settings
  add column if not exists automation_enabled boolean not null default false;

notify pgrst, 'reload schema';
