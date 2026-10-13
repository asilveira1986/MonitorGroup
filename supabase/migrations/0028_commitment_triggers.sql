-- =====================================================================
-- Gatilhos de compromisso da equipe para registrar demandas
--
-- Além das frases prontas (demand_commitment_keywords), o worker reconhece
-- verbos de ação em qualquer forma de compromisso:
--   "irei verificar", "vou corrigir", "vamos já te enviar", "estou ajustando",
--   "verificarei", "fico de enviar", "pode deixar que eu corrijo".
-- Negação logo antes ("não vou conseguir verificar") não conta.
--  * demand_commitment_verbs: verbos de ação no infinitivo (editáveis).
-- =====================================================================

alter table public.app_settings
  add column if not exists demand_commitment_verbs text[] not null default array[
    'verificar', 'checar', 'conferir', 'analisar', 'olhar', 'ver', 'avaliar', 'investigar', 'revisar', 'validar', 'testar',
    'corrigir', 'ajustar', 'arrumar', 'consertar', 'resolver', 'solucionar', 'tratar', 'atualizar', 'alterar', 'configurar',
    'realizar', 'fazer', 'executar', 'providenciar', 'preparar', 'organizar', 'programar', 'agendar', 'cadastrar', 'liberar',
    'enviar', 'mandar', 'encaminhar', 'emitir', 'gerar', 'entregar', 'finalizar', 'concluir', 'retornar', 'responder',
    'avisar', 'confirmar', 'levantar', 'solicitar', 'acompanhar', 'alinhar', 'buscar', 'separar', 'instalar', 'refazer'
  ]::text[];

-- frases prontas que não dependem de verbo
update public.app_settings
   set demand_commitment_keywords = demand_commitment_keywords
       || array(select k from unnest(array['dar uma olhada', 'dou uma olhada', 'deixa comigo', 'pode deixar', 'fica comigo',
                                           'em andamento', 'assim que possível']::text[]) k
                where not k = any(demand_commitment_keywords))
 where id = 1;

notify pgrst, 'reload schema';
