-- =====================================================================
-- Índice dos alertas ainda em aberto, por grupo e tipo.
--
-- "Marcar como respondida", o encerramento da automação de atendimento (0144) e a exclusão de uma regra (0146)
-- procuram os alertas NÃO resolvidos de um grupo (group_id + type). Sem índice por grupo isso varria a tabela
-- inteira a cada resposta da equipe. O índice é parcial: só guarda os alertas em aberto, que são poucos.
-- =====================================================================

create index if not exists alerts_group_open_idx on public.alerts (group_id, type) where status <> 'resolved';
