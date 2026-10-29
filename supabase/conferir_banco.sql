-- ---------------------------------------------------------------------
-- Conferência: o SQL Editor mostra esta tabela no final.
-- Todas as linhas com "OK" = banco atualizado.
-- ---------------------------------------------------------------------
select item as "Item", case when ok then 'OK' else 'FALTANDO' end as "Situação"
from (values
  (1, 'Indicadores e configurações (0008)', to_regclass('public.indicators') is not null),
  (2, 'Horário comercial nos indicadores (0009)', to_regprocedure('public.business_seconds(timestamptz,timestamptz,jsonb)') is not null),
  (3, 'Demandas (0010)', to_regclass('public.demands') is not null),
  (4, 'Blocos 3 e 4 de indicadores (0011)', to_regprocedure('public.ind_grupos_silenciosos(jsonb,jsonb)') is not null),
  (5, 'Responder pelo sistema (0012)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'reply_allowed')),
  (6, 'Um worker por vez (0013)', to_regclass('public.worker_lock') is not null),
  (7, 'Reincidência de falta de resposta (0014)', to_regprocedure('public.ind_reincidencia_sem_resposta(jsonb,jsonb)') is not null),
  (8, 'Alerta de reincidência (0015)', exists (select 1 from public.alert_rules where type = 'recurrence')),
  (9, 'Horários de pico com resumo (0016)', (select description like 'Quando os clientes mais escrevem%' from public.indicators where key = 'horarios_pico')),
  (10, 'Pendentes por grupo e arquivos recebidos (0017)', to_regprocedure('public.ind_arquivos_recebidos(jsonb,jsonb)') is not null),
  (11, 'Tempo de resposta desde a última mensagem do cliente (0018)',
      exists (select 1 from pg_proc where proname = 'ingest_message' and pronamespace = 'public'::regnamespace
              and obj_description(oid, 'pg_proc') ~ '00(18|37|43)')),
  (12, 'Análise "Precisa de resposta?" (0019)', to_regprocedure('public.ind_analise_sem_resposta(jsonb,jsonb)') is not null),
  (13, 'Arquivos sem visualização (0020)', to_regprocedure('public.mark_media_seen(uuid,uuid)') is not null),
  (14, 'Início e fechamento das conversas (0021)', to_regprocedure('public.ind_conversas_ciclo(jsonb,jsonb)') is not null),
  (15, 'Acompanhamento do dia (0022)', to_regprocedure('public.ind_dia_hora_a_hora(jsonb,jsonb)') is not null),
  (16, 'Painel de grupos (0023)', to_regprocedure('public.groups_panel()') is not null),
  (17, 'Configuração do alerta de nova mensagem (0024)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'msg_alert_auto_close')),
  (18, 'Alertas em tela e SLA excedido (0025)', to_regprocedure('public.sla_breaches()') is not null),
  (19, 'Demandas pelo compromisso da equipe (0026)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'demand_commitment_enabled')),
  (20, 'Setores e permissões por setor (0027)', to_regclass('public.sectors') is not null
      and (select not prosecdef from pg_proc where oid = 'public.indicator_values(timestamptz,timestamptz,uuid,uuid)'::regprocedure)),
  (21, 'Gatilhos de compromisso para demandas (0028)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'demand_commitment_verbs')),
  (22, 'Visão da gestão no dashboard (0029)', to_regprocedure('public.management_summary(timestamptz,timestamptz,uuid,uuid)') is not null),
  (23, 'Multiempresa (0030)', to_regclass('public.companies') is not null
      and to_regprocedure('public.create_company(text,text,text,text,text,integer,integer,text)') is not null),
  (24, 'Menus liberados por empresa (0031)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'menu_access')),
  (25, 'Aviso por voz (0032)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'msg_alert_voice')),
  (26, 'Aviso por voz nas regras de alerta (0033)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'alert_rules' and column_name = 'voice')),
  (27, 'Opções do aviso por voz (0034)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'msg_alert_voice_templates')),
  (28, 'Perfil somente ver painéis (0035)', to_regprocedure('public.can_write()') is not null),
  (29, 'Membros dos grupos (0036)', to_regclass('public.group_participants') is not null),
  (30, 'Desconsiderar figurinha/emoji (0037)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'ignored_as_last')),
  (31, 'Imagens e áudios no sistema (0038)', to_regprocedure('public.media_usage()') is not null
      and exists (select 1 from storage.buckets where id = 'media' and not public)),
  (32, 'Responsável pelo grupo (0039)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'groups' and column_name = 'responsible_member_id')),
  (33, 'Recalcular grupos pela equipe (0040)', to_regprocedure('public.recalc_company_groups(uuid)') is not null),
  (34, 'Frases a ignorar (0041)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'app_settings' and column_name = 'ignore_phrases')),
  (35, 'Mensagens rápidas (0042)', to_regclass('public.quick_replies') is not null),
  (36, 'Fechamento da conversa (0043)', (to_regprocedure('public.send_group_message(uuid,text,uuid,boolean)') is not null
       or to_regprocedure('public.send_group_message(uuid,text,uuid,boolean,jsonb)') is not null)
      and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'groups' and column_name = 'closed_at')),
  (37, 'Fotos de perfil (0044)', to_regclass('public.contact_avatars') is not null),
  (38, 'Foto de perfil ampliada (0045)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'contact_avatars' and column_name = 'full_path')),
  (39, 'Busca de palavras-chave mais rápida (0046)',
      coalesce(obj_description('public.match_keyword(text,jsonb)'::regprocedure, 'pg_proc'), '') like '%0046%'
      or exists (select 1 from pg_proc where proname = 'match_keyword' and prolang = (select oid from pg_language where lanname = 'plpgsql'))),
  (40, 'Nome e telefone do cliente na conversa (0047)', coalesce(pg_get_functiondef('public.group_members(uuid)'::regprocedure) like '%p.lid,%', false)),
  (41, 'Sem mensagens técnicas do WhatsApp (0048)', not exists (select 1 from public.messages
      where message_type in ('secretEncrypted', 'encEventResponse', 'encComment', 'pollResultSnapshot', 'placeholder', 'statusMention'))),
  (42, 'Arquivos e vídeos + equipe com acesso (0049)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'team_members' and column_name = 'user_email')),
  (43, 'Log de atividades (0050)', to_regprocedure('public.platform_activity_log(timestamptz,timestamptz,uuid,text,text,integer,integer)') is not null),
  (44, 'Equipe reconhecida pelo LID (0051)', exists (select 1 from pg_proc where proname in ('recalc_company_groups', 'recalc_company_groups_core')
      and pronamespace = 'public'::regnamespace and prosrc like '%gp.lid = m.sender_jid%')),
  (45, 'Silenciar grupo retirado (0053)', to_regclass('public.group_mutes') is null and not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'sectors' and column_name = 'can_mute')),
  (46, 'Silenciar alertas retirado (0055)', to_regclass('public.alert_type_mutes') is null and not exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'sectors' and column_name = 'can_mute_alerts')),
  (47, 'Vários responsáveis por grupo (0056)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'groups' and column_name = 'responsible_member_ids')
      and to_regprocedure('public.my_alert_groups()') is not null),
  (48, 'Grupo sem responsável avisa todos (0057)', coalesce(pg_get_functiondef('public.my_alert_groups()'::regprocedure) like '%cardinality(g.responsible_member_ids) = 0%', false)),
  (49, 'Meus alertas (0058)', to_regprocedure('public.set_my_alerts_off(boolean)') is not null),
  (50, 'Entrega pelo responsável e agenda (0059)', to_regprocedure('public.my_due_demands()') is not null
      and exists (select 1 from pg_trigger where tgname = 'demands_check_delivery')),
  (51, 'Compromissos na agenda (0060)', to_regclass('public.agenda_events') is not null),
  (52, 'Tipos de demanda (0061)', to_regprocedure('public.rename_demand_type(text,text)') is not null),
  (53, 'Reações nas mensagens (0062)', to_regclass('public.message_reactions') is not null),
  (54, 'Responsável vê as próprias demandas (0063)', exists (select 1 from pg_policies where tablename = 'demands' and policyname = 'demands_read'
      and qual like '%my_team_member_ids%')),
  (55, 'Pacotes técnicos barrados no banco (0064)', exists (select 1 from pg_trigger where tgname = 'messages_skip_technical')),
  (56, 'Envio de mensagem sem erro de assignee_id (0065)', coalesce(pg_get_functiondef('public.guard_group_write()'::regprocedure) like '%só são lidos em gravações de demandas%', false)),
  (57, 'Editar e apagar mensagens (0066)', to_regprocedure('public.request_message_action(uuid,text,text)') is not null),
  (58, 'Apagar para mim (0067)', exists (select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'hidden_at')),
  (59, 'Entregue e lida (0068)', to_regclass('public.message_receipts') is not null),
  (60, 'Conversas privadas (0069)', to_regclass('public.private_chats') is not null and to_regprocedure('public.start_private_chat(text,text,text)') is not null),
  (61, 'Conversas privadas: arquivos, reações, editar e apagar (0070)', to_regprocedure('public.request_private_action(uuid,text,text,text)') is not null),
  (62, 'Conversas privadas: enviar arquivos e citar (0071)', to_regprocedure('public.send_private_message(uuid,text,uuid,jsonb)') is not null),
  (63, 'Sincronizar contatos (0072)', to_regprocedure('public.request_contacts_sync()') is not null),
  (64, 'Contatos com o nome salvo (0073)', to_regprocedure('public.save_wa_contacts(uuid,jsonb)') is not null),
  (65, 'Enviar áudio (0074)', to_regprocedure('public.send_group_message(uuid,text,uuid,boolean,jsonb)') is not null),
  (66, 'Nome salvo pelo número (0075)', to_regprocedure('public.phone_key(text)') is not null),
  (67, 'Verificação completa cliente × equipe (0076)', to_regclass('public.group_participants_lid_idx') is not null),
  (68, 'Número do LID pela sessão (0077)', to_regprocedure('public.lid_phone(uuid,text)') is not null),
  (69, 'Mensagens sem remetente (0078)', to_regprocedure('public.set_message_sender(uuid,uuid)') is not null),
  (70, 'Membros × atendentes e agenda (0079)', exists (select 1 from pg_proc where proname = 'group_members' and prosrc like '%phone_key%')),
  (71, 'Remetente pela citação (0080)', to_regprocedure('public.identify_message_sender(uuid,text,text,text,uuid,boolean)') is not null),
  (72, 'Remetente pelos membros do grupo (0081)', exists (select 1 from pg_proc where proname in ('recalc_company_groups', 'recalc_company_groups_core') and prosrc like '%0081%')),
  (73, 'Log do quem enviou? (0082)', exists (select 1 from pg_proc where proname = 'set_message_sender' and prosrc like '%activity_log%')),
  (74, 'Logo da empresa e foto dos atendentes (0083)', to_regprocedure('public.set_company_logo(text)') is not null),
  (75, 'Revisão só dos grupos que mudaram (0084)', to_regprocedure('public.recalc_company_senders(uuid)') is not null),
  (76, 'Meu perfil (0085)', to_regprocedure('public.update_my_profile(text,text)') is not null),
  (77, 'Responsável na lista de membros (0086)', exists (select 1 from pg_proc where proname = 'group_members' and prosrc like '%team_member_id%')),
  (78, 'Responsável vê os seus grupos (0087)', to_regprocedure('public.my_responsible_group_ids()') is not null),
  (79, 'Duração dos áudios (0088)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'media_seconds')),
  (80, 'Agradecimento depois da equipe (0089)', to_regprocedure('public.is_thanks_after_team(text)') is not null),
  (81, 'Citações nas respostas (0090)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'messages' and column_name = 'quoted_wa_id')),
  (82, 'Aviso ao cliente da demanda (0091)', to_regprocedure('public.demands_notify_client()') is not null),
  (83, 'Aviso de demanda concluída (0092)', to_regprocedure('public.deliver_demand(uuid,text,text)') is not null),
  (84, 'Avisos do sistema sempre vão (0093)', exists (select 1 from pg_proc where proname = 'guard_group_write' and prosrc like '%system_notice%')),
  (85, 'Todos respondem nos grupos (0094)', exists (select 1 from pg_proc where proname = 'has_group_permission' and prosrc like '%(0094)%')),
  (86, 'Sem acesso sem login (0095)', not has_function_privilege('anon', 'public.company_indicator_params(uuid,text)', 'execute')),
  (87, 'LGPD: prazo de guarda e pedidos dos titulares (0096)', to_regprocedure('public.lgpd_person_erase(text)') is not null),
  (88, 'Agenda por usuário (0097)', to_regclass('public.agenda_event_people') is not null),
  (89, 'Notificações push (0098)', to_regprocedure('public.claim_push_deliveries(integer)') is not null),
  (90, 'Push sem avisos atrasados (0099)', coalesce(position('30 minutes' in pg_get_functiondef(to_regprocedure('public.claim_push_deliveries(integer)'))), 0) > 0),
  (91, 'Push: permissões do worker (0100)', coalesce(has_table_privilege('service_role', to_regclass('public.push_events'), 'update'), false)),
  (92, 'Lembretes dos compromissos (0101)', to_regprocedure('public.agenda_reminder_label(integer,boolean)') is not null),
  (93, 'Tipos e repetição dos compromissos (0102)', to_regprocedure('public.delete_agenda_event(uuid,text)') is not null
        and exists (select 1 from pg_trigger where tgname = 'agenda_people_push' and tgrelid = to_regclass('public.agenda_event_people'))),
  (94, 'Etiquetas de clientes (0103)', to_regprocedure('public.set_group_tags(uuid,uuid[])') is not null),
  (95, 'LGPD só para o administrador geral (0104)', exists (select 1 from pg_trigger where tgname = 'app_settings_guard_retention')),
  (96, 'Encaminhar e responder entre conversas (0105)', to_regprocedure('public.forward_message(text,uuid,text,uuid)') is not null),
  (97, 'Avisos no WhatsApp da equipe (0106)', to_regprocedure('public.claim_team_whatsapp(integer)') is not null),
  (98, 'Pessoas e setores sem cadastro duplicado (0107)', to_regprocedure('public.agenda_sectors()') is not null),
  (99, 'Limpeza do que fica sem uso (0108)', to_regprocedure('public.cleanup_old_data()') is not null),
  (100, 'Lista de contatos completa (0109)', to_regprocedure('public.contact_directory(text,integer)') is not null),
  (101, 'Agradecimento respondendo a equipe (0110)', exists (select 1 from public.schema_migrations where version = '0110')),
  (102, 'Reação da equipe conta como resposta (0111)', to_regprocedure('public.answer_by_reaction(uuid)') is not null),
  (103, 'Contatos (0112)', to_regprocedure('public.save_contact(uuid,text,text,text,text,text,uuid[])') is not null),
  (104, 'Contatos com nome e foto (0113)', exists (select 1 from pg_proc where proname = 'contact_directory' and prosrc like '%photo_jid%')),
  (105, 'Conversas privadas por usuário (0114)', coalesce(to_regprocedure('public.assign_private_chat(uuid,uuid)'), to_regprocedure('public.assign_private_chat(uuid,uuid,text)')) is not null),
  (106, 'Dashboard mais rápido (0115)', to_regprocedure('public.dashboard_bundle(timestamptz,timestamptz,uuid,uuid,boolean)') is not null),
  (107, 'Assinatura no privado (0116)', to_regprocedure('public.private_sign_text(uuid,uuid,text)') is not null),
  (108, 'Nome dos contatos sem número mascarado (0117)', to_regprocedure('public.contact_real_name(text)') is not null),
  (109, 'Marcar conversa como não lida (0118)', to_regprocedure('public.mark_private_chat_unread(uuid)') is not null),
  (110, 'Finalizar e transferir atendimento no privado (0119)', to_regprocedure('public.finish_private_chat(uuid)') is not null),
  (111, 'Avisos das conversas privadas (0120)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'app_settings' and column_name = 'private_alert_mine')),
  (112, 'Setor do número de WhatsApp (0121)', to_regprocedure('public.set_instance_sector(uuid,uuid)') is not null),
  (113, 'Grupos no setor do número (0122)', exists (select 1 from pg_proc where proname = 'groups_default_sector' and prosrc like '%whatsapp_instances%')),
  (114, 'Troca de senha no primeiro acesso (0123)', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'must_change_password')),
  (115, 'Conversas aguardando para todos (0124)', exists (select 1 from pg_proc where proname = 'private_instance_ok' and prosrc not like '%sector%')),
  (116, 'Conversa assinada pelo WhatsApp fica com o usuário (0125)', exists (select 1 from pg_trigger where tgname = 'private_messages_signer_owner')),
  (117, 'Indicadores no catálogo: ' || (select count(*) from public.indicators), (select count(*) from public.indicators) >= 24)
) as t(ord, item, ok)
order by ord;
