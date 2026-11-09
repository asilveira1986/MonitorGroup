-- =====================================================================
-- Log de atividades: o aviso de presença não é uma alteração do usuário.
--
-- O painel aberto avisa a cada 2 minutos que a pessoa está ativa e isso
-- grava profiles.last_seen_at (0135). Como o campo não estava na lista de
-- colunas ignoradas pelo log (activity_noise, 0050), cada aviso virava uma
-- linha "Alterou o usuário ...: last_seen_at = ..." e escondia as ações
-- reais. Agora last_seen_at é ignorado: uma alteração que mexe só nele não
-- gera linha, e se vier junto de outra, só a outra aparece.
--
-- As linhas antigas continuam no log; para apagá-las, rode
-- supabase/limpar_log_last_seen.sql (opcional, separado).
-- =====================================================================

create or replace function public.activity_noise()
returns text[] language sql immutable as $$
  select array['updated_at', 'created_at', 'last_message_at', 'last_client_message_at', 'last_team_message_at',
               'last_message_preview', 'participants_count', 'pending_count', 'pending_message_id',
               'conversation_started_at', 'closed_at', 'seen_at', 'seen_via', 'seen_by', 'status_changed_at',
               'number', 'id', 'last_seen_at']
$$;
