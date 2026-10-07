-- =====================================================================
-- Demandas automáticas pelo compromisso da equipe
--
-- Quando alguém da equipe responde no grupo com uma frase de compromisso
-- ("vou verificar", "te retorno em seguida", "até amanhã te envio",
-- "prazo..."), o worker abre uma demanda com o pedido do cliente que foi
-- respondido, o atendente como responsável e o prazo, se a mensagem trouxer
-- um ("até sexta", "até 15/10", "em 2 dias").
--  * demand_commitment_enabled: liga/desliga (padrão: ligado);
--  * demand_commitment_keywords: frases de compromisso (editáveis).
-- Origem nova da demanda: 'commitment' (compromisso da equipe).
-- =====================================================================

alter table public.app_settings
  add column if not exists demand_commitment_enabled boolean not null default true,
  add column if not exists demand_commitment_keywords text[] not null default array[
    'vou verificar', 'vamos verificar', 'vou ver', 'vamos ver', 'vou checar', 'vamos checar', 'vou analisar',
    'vamos analisar', 'vou conferir', 'vamos conferir', 'te retorno', 'retorno em seguida', 'retorno em breve',
    'já retorno', 'ja te retorno', 'retornamos', 'retorno até', 'te aviso', 'aviso assim que', 'assim que tiver',
    'vou providenciar', 'vamos providenciar', 'vou encaminhar', 'vamos encaminhar', 'vou resolver',
    'vamos resolver', 'vou enviar', 'vamos enviar', 'te envio', 'prazo'
  ]::text[];

alter table public.demands drop constraint if exists demands_source_check;
alter table public.demands add constraint demands_source_check
  check (source in ('manual', 'keyword', 'ai', 'commitment'));

notify pgrst, 'reload schema';
