-- =====================================================================
-- ATUALIZAÇÃO DO BANCO, PARTE 2 DE 2 (gerado por supabase/build-updates.sh)
-- Rode as partes na ordem (1, 2...). Cada uma pode ser repetida.
-- Junta os scripts 0002 em diante, na ordem. Pode ser executado quantas
-- vezes quiser.
-- Pré-requisito: 0001_schema.sql já executado (instalação inicial).
--
-- O banco guarda quais scripts já foram aplicados (schema_migrations):
-- só os que faltam rodam, então quase nada é travado. Se mesmo assim o
-- banco acusar "deadlock detected" (o worker e o painel usando as tabelas),
-- a parte é repetida sozinha, até 5 vezes. Se ainda assim falhar, o que já
-- foi aplicado fica e basta executar de novo.
-- =====================================================================

-- controle dos scripts aplicados
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;

-- aplica um script uma vez só; deadlock ou trava demorada: espera e tenta de novo
create or replace function public._apply_migration(p_version text, p_sql text)
returns text
language plpgsql
as $fn$
declare
  i int;
begin
  if exists (select 1 from public.schema_migrations where version = p_version) then
    return p_version || ': já aplicado';
  end if;
  for i in 1..5 loop
    begin
      perform set_config('lock_timeout', '15s', true);
      execute p_sql;
      insert into public.schema_migrations (version) values (p_version) on conflict do nothing;
      return p_version || ': aplicado';
    exception when deadlock_detected or lock_not_available then
      if i = 5 then
        raise;
      end if;
      raise notice '%: tabela ocupada (tentativa %), tentando de novo...', p_version, i;
      perform pg_sleep(2 * i);
    end;
  end loop;
  return p_version;
end;
$fn$;

-- primeira vez com o controle: marca como aplicados os scripts que o banco já
-- tem (todos antes do primeiro item da conferência que falta), para não refazer tudo
do $seed$
declare
  v_fail text;
begin
  if exists (select 1 from public.schema_migrations) then
    return;
  end if;
  begin
    execute $q$
      select coalesce(min(substring(item from '\((\d{4})\)')), '9999')
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
      or exists (select 1 from pg_proc where proname = 'match_keyword' and prolang = (select oid from pg_language where lanname = 'plpgsql'))
      -- 0115 refez a busca (padrão das palavras guardado no carregamento)
      or to_regprocedure('public.kw_pattern(jsonb)') is not null),
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
  (117, 'Assinatura sem diferenciar acentos (0126)', to_regprocedure('public.private_name_key(text)') is not null),
  (118, 'Assinatura em qualquer formato (0127)', to_regprocedure('public.private_signature(text)') is not null),
  (119, 'Assinatura para todos os usuários (0128)', to_regprocedure('public.private_signer_names(uuid)') is not null),
  (120, 'Setor padrão vê tudo (0129)', to_regprocedure('public.private_sees_team()') is not null),
  (121, 'Dashboard do privado (0130)', to_regprocedure('public.private_dashboard(timestamptz,timestamptz,uuid,boolean)') is not null),
  (122, 'Dashboard mais rápido (0131)', to_regprocedure('public.ind_responses_calc(jsonb)') is not null),
  (123, 'Recalcular grupos em etapas (0132)', to_regprocedure('public.recalc_company_rebuild(uuid,uuid[])') is not null),
  (124, 'Outro número da empresa conta como empresa (0133)', coalesce(pg_get_functiondef('public.recalc_company_reclassify(uuid)'::regprocedure) like '%0133%', false)),
  (125, 'Indicadores no catálogo: ' || (select count(*) from public.indicators), (select count(*) from public.indicators) >= 24)
      ) as t(ord, item, ok)
      where not coalesce(ok, false)
    $q$ into v_fail;
  exception when others then
    v_fail := null; -- banco antigo: aplica tudo (o que já existe é mantido)
  end;
  if v_fail is not null then
    insert into public.schema_migrations (version)
    select v from unnest(string_to_array('0002,0003,0004,0005,0006,0007,0008,0009,0010,0011,0012,0013,0014,0015,0016,0017,0018,0019,0020,0021,0022,0023,0024,0025,0026,0027,0028,0029,0030,0031,0032,0033,0034,0035,0036,0037,0038,0039,0040,0041,0042,0043,0044,0045,0046,0047,0048,0049,0050,0051,0052,0053,0054,0055,0056,0057,0058,0059,0060,0061,0062,0063,0064,0065,0066,0067,0068,0069,0070,0071,0072,0073,0074,0075,0076,0077,0078,0079,0080,0081,0082,0083,0084,0085,0086,0087,0088,0089,0090,0091,0092,0093,0094,0095,0096,0097,0098,0099,0100,0101,0102,0103,0104,0105,0106,0107,0108,0109,0110,0111,0112,0113,0114,0115,0116,0117,0118,0119,0120,0121,0122,0123,0124,0125,0126,0127,0128,0129,0130,0131,0132,0133', ',')) v where v < v_fail
    on conflict do nothing;
  end if;
end $seed$;

-- >>>>>>>>>>>>>>>>>>>> 0109_contact_directory.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0109', $mig0109$
-- =====================================================================
-- Lista de contatos completa (Nova conversa no privado).
--
--  * Junta, numa lista só e sem repetir a mesma pessoa:
--    - os contatos da agenda do WhatsApp conectado (nome salvo e número);
--    - quem já tem conversa privada (inclusive números digitados no
--      sistema);
--    - as pessoas da equipe (com o WhatsApp cadastrado).
--  * A mesma pessoa vinda pelo número e pelo identificador do WhatsApp
--    (LID) aparece uma vez, com o nome salvo e o número. O número do LID
--    é descoberto pelo mapeamento guardado pelo WhatsApp conectado.
--  * Antes a lista mostrava só 50 contatos; agora mostra todos (com busca
--    por nome ou número).
-- =====================================================================

-- o telefone dos contatos que só vieram pelo LID (mapeamento do WhatsApp conectado)
create or replace function public.link_wa_contacts(p_instance_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.wa_contacts t
     set phone = public.lid_phone(p_instance_id, t.jid), updated_at = now()
   where t.instance_id = p_instance_id and t.phone is null and t.jid like '%@lid'
     and public.lid_phone(p_instance_id, t.jid) is not null;
  update public.wa_contacts t
     set phone = public.lid_phone(p_instance_id, t.lid), updated_at = now()
   where t.instance_id = p_instance_id and t.phone is null and t.lid like '%@lid'
     and public.lid_phone(p_instance_id, t.lid) is not null;
  -- telefone para a linha do LID
  update public.wa_contacts t
     set phone = s.phone, updated_at = now()
    from public.wa_contacts s
   where t.instance_id = p_instance_id and s.instance_id = p_instance_id
     and t.jid <> s.jid and t.phone is null and s.phone is not null
     and (t.jid = s.lid or (t.lid is not null and t.lid = s.lid));
  -- nome salvo para a outra linha da mesma pessoa (pelo LID ou pelo número, com ou sem o 9)
  update public.wa_contacts t
     set name = s.name, updated_at = now()
    from public.wa_contacts s
   where t.instance_id = p_instance_id and s.instance_id = p_instance_id
     and t.jid <> s.jid and t.name is null and s.name is not null
     and ((t.phone is not null and public.phone_key(t.phone) = public.phone_key(s.phone))
          or (t.lid is not null and (t.lid = s.lid or t.lid = s.jid))
          or (s.lid is not null and s.lid = t.jid));
  -- conversas: nome salvo no lugar de nenhum nome, do nome do WhatsApp ou só do número
  update public.private_chats c
     set name = w.name
    from public.wa_contacts w
   where c.instance_id = p_instance_id and w.instance_id = p_instance_id
     and w.name is not null and c.name is distinct from w.name
     and (w.jid = c.jid or (c.phone is not null and public.phone_key(w.phone) = public.phone_key(c.phone)))
     and (c.name is null or c.name = w.notify or c.name ~ '^[0-9 +()-]+$');
  -- conversas sem número que agora têm (pelo contato)
  update public.private_chats c
     set phone = w.phone
    from public.wa_contacts w
   where c.instance_id = p_instance_id and w.instance_id = p_instance_id
     and c.phone is null and w.phone is not null and (w.jid = c.jid or w.lid = c.jid);
end;
$$;
revoke all on function public.link_wa_contacts(uuid) from public, anon, authenticated;
grant execute on function public.link_wa_contacts(uuid) to service_role;

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.whatsapp_instances loop
    perform public.link_wa_contacts(v_id);
  end loop;
end $$;

-- a lista: agenda do WhatsApp + conversas + equipe, uma linha por pessoa
create or replace function public.contact_directory(p_search text default null, p_limit int default 5000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_out jsonb;
begin
  if not public.can_use_private_chats() then
    return '[]'::jsonb;
  end if;
  with src as (
    -- agenda do WhatsApp (nome salvo = prioridade 1)
    select w.jid, w.phone, w.name, w.notify, 'agenda'::text as origem,
           case when w.name is not null then 1 else 4 end as prio
      from public.wa_contacts w
     where w.company_id = v_company
       and w.jid not like '%@g.us' and w.jid not like '%@broadcast' and w.jid not like '%@newsletter'
    union all
    -- conversas privadas (números digitados no sistema e quem escreveu no privado)
    select c.jid, c.phone, c.name, null, 'conversa', case when c.name is not null then 2 else 5 end
      from public.private_chats c
     where c.company_id = v_company
    union all
    -- pessoas da equipe com WhatsApp
    select t.phone || '@s.whatsapp.net', t.phone, t.name, null, 'equipe', 3
      from public.team_members t
     where t.company_id = v_company and t.active and t.phone is not null
  ), keyed as (
    select s.*, coalesce('p' || public.phone_key(s.phone), 'j' || s.jid) as k from src s
  ), merged as (
    select k,
           -- o nome mais confiável (agenda > conversa > equipe), senão o nome no WhatsApp
           (array_agg(name order by prio) filter (where name is not null))[1] as name,
           (array_agg(notify) filter (where notify is not null))[1] as notify,
           (array_agg(phone order by prio) filter (where phone is not null))[1] as phone,
           -- para abrir a conversa: a que já existe, senão pelo número, senão o identificador
           coalesce((array_agg(jid) filter (where origem = 'conversa'))[1],
                    (array_agg(jid) filter (where jid like '%@s.whatsapp.net'))[1],
                    (array_agg(jid))[1]) as jid,
           bool_or(origem = 'agenda' and name is not null) as na_agenda,
           bool_or(origem = 'conversa') as tem_conversa,
           bool_or(origem = 'equipe') as equipe
      from keyed group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jid', jid, 'phone', phone, 'name', name, 'notify', notify,
           'saved', na_agenda, 'chat', tem_conversa, 'team', equipe)
           order by (name is null and notify is null), lower(coalesce(name, notify, phone, jid))), '[]'::jsonb)
    into v_out
    from (
      select * from merged m
       where (v_term is null
              or m.name ilike '%' || v_term || '%' or m.notify ilike '%' || v_term || '%'
              or (v_digits is not null and length(v_digits) >= 3 and m.phone like '%' || v_digits || '%'))
       order by (m.name is null and m.notify is null), lower(coalesce(m.name, m.notify, m.phone, m.jid))
       limit greatest(1, least(coalesce(p_limit, 5000), 20000))
    ) x;
  return v_out;
end;
$$;
grant execute on function public.contact_directory(text, int) to authenticated;
$mig0109$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0110_thanks_reply_to_team.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0110', $mig0110$
-- =====================================================================
-- Agradecimento respondendo a uma mensagem da equipe não deixa pendência.
--
-- Ex.: a atendente manda um arquivo e o cliente responde (citando) com
-- "Obrigado @Cíntia". Mesmo que outra mensagem do cliente tenha vindo no
-- meio, a resposta à mensagem da equipe que só agradece/confirma encerra o
-- assunto (a mesma regra de "logo depois da equipe": volta a pedir
-- resposta se vier pergunta, pedido, problema ou "não"). O worker já faz
-- assim nas novas; aqui valem também as mensagens já gravadas, e os grupos
-- são recalculados (pendências só diminuem).
-- =====================================================================

do $$
declare
  v_n int;
  v_c uuid;
  v_r jsonb;
begin
  update public.messages m set opens_pending = false
    from public.groups g
    join public.app_settings s on s.company_id = g.company_id and s.ignore_acknowledgements
   where g.id = m.group_id
     and m.opens_pending and not m.from_team and m.message_type = 'text'
     and m.quoted_wa_id is not null
     and public.is_thanks_after_team(m.body)
     and exists (select 1 from public.messages q
                  where q.group_id = m.group_id and q.wa_message_id = m.quoted_wa_id and q.from_team);
  get diagnostics v_n = row_count;
  raise notice '% agradecimento(s) respondendo a equipe deixaram de abrir pendência', v_n;
  if v_n > 0 then
    for v_c in select id from public.companies loop
      v_r := public.recalc_company_groups(v_c);
    end loop;
  end if;
end $$;
$mig0110$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0111_reaction_answers.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0111', $mig0111$
-- =====================================================================
-- Reação da equipe conta como resposta.
--
-- Quando a equipe (o número conectado ou alguém cadastrado em Pessoas)
-- reage a uma mensagem do cliente (👍 🙏 😂 ...), o grupo deixa de
-- aguardar resposta, desde que não haja mensagem do cliente depois da que
-- recebeu a reação. Os alertas de "sem resposta" do grupo são resolvidos.
-- Liga/desliga em Configurações › WhatsApp › Respostas e mensagens
-- (começa ligado). Os grupos que já estão aguardando e têm essa reação
-- também são acertados.
-- =====================================================================

alter table public.app_settings add column if not exists reaction_answers boolean not null default true;

-- o worker chama ao gravar a reação da equipe (p_message: a mensagem que recebeu a reação)
create or replace function public.answer_by_reaction(p_message uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  m public.messages%rowtype;
  g public.groups%rowtype;
begin
  select * into m from public.messages where id = p_message;
  if m.id is null or m.from_team then
    return false;
  end if;
  select * into g from public.groups where id = m.group_id;
  if g.id is null or g.pending_since is null
     or not coalesce((select reaction_answers from public.app_settings where company_id = g.company_id), true) then
    return false;
  end if;
  -- o cliente escreveu de novo depois da mensagem que recebeu a reação: ainda aguarda
  if exists (select 1 from public.messages x
              where x.group_id = m.group_id and not x.from_team and x.opens_pending and not x.ignored_as_last
                and x.sent_at > m.sent_at) then
    return false;
  end if;
  update public.groups set pending_since = null, pending_message_id = null, pending_count = 0 where id = g.id;
  update public.alerts set status = 'resolved', resolved_at = now()
   where group_id = g.id and type = 'no_response' and status <> 'resolved';
  return true;
end;
$$;
revoke all on function public.answer_by_reaction(uuid) from public, anon, authenticated;
grant execute on function public.answer_by_reaction(uuid) to service_role;

-- os grupos que já aguardam e têm reação da equipe na última mensagem do cliente
do $$
declare
  r record;
  v_n int := 0;
begin
  for r in
    select distinct on (m.group_id) m.id
      from public.message_reactions x
      join public.messages m on m.id = x.message_id and not m.from_team
      join public.groups g on g.id = m.group_id and g.pending_since is not null
     where x.from_team and m.sent_at >= g.pending_since
     order by m.group_id, m.sent_at desc
  loop
    if public.answer_by_reaction(r.id) then
      v_n := v_n + 1;
    end if;
  end loop;
  raise notice '% grupo(s) respondidos por reação da equipe', v_n;
end $$;
$mig0111$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0112_contacts.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0112', $mig0112$
-- =====================================================================
-- Contatos: a agenda do WhatsApp conectado e os contatos do sistema numa
-- tela só (menu Contatos).
--
--  * contacts: contatos cadastrados no sistema (nome, telefone, e-mail,
--    empresa, observações e etiquetas). Um por telefone na empresa.
--  * Editar um contato da agenda do WhatsApp cria o cadastro dele no
--    sistema: o nome do sistema passa a valer no painel (a agenda do
--    celular não muda).
--  * O nome do contato vale também nas conversas privadas com o mesmo
--    número (as que já existem e as que começarem depois), e as etiquetas
--    ficam iguais nas duas.
--  * contact_directory() passa a trazer os contatos do sistema, com o
--    e-mail, a empresa, as observações, as etiquetas e a conversa.
--  * Mesmo acesso das conversas privadas. O pedido do titular (LGPD)
--    também apaga e exporta o cadastro.
-- =====================================================================

create table if not exists public.contacts (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  phone        text,
  email        text,
  organization text,
  notes        text,
  tags         uuid[] not null default '{}',
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists contacts_company_phone_key on public.contacts (company_id, public.phone_key(phone)) where phone is not null;
create index if not exists contacts_company_name_idx on public.contacts (company_id, lower(name));
alter table public.contacts enable row level security;
drop policy if exists contacts_read on public.contacts;
create policy contacts_read on public.contacts for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id()));
revoke all on public.contacts from anon;
grant select on public.contacts to authenticated;
grant select, insert, update, delete on public.contacts to service_role;

-- ------------------------------------------------ salvar (novo ou edição)
create or replace function public.save_contact(
  p_id uuid, p_name text, p_phone text, p_email text default null, p_organization text default null,
  p_notes text default null, p_tags uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_phone text := public.br_phone(p_phone);
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_tags uuid[] := public.clean_customer_tags(coalesce(p_tags, '{}'));
  v_old text;
  v_id uuid;
begin
  if not public.can_use_private_chats() then
    raise exception 'Os contatos não estão liberados para você nesta empresa.' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'Informe o nome do contato.';
  end if;
  if v_phone is not null and (length(v_phone) < 12 or length(v_phone) > 15) then
    raise exception 'Informe o número com DDD (e o código do país, se não for do Brasil).';
  end if;
  if v_phone is null and v_email is null then
    raise exception 'Informe o telefone ou o e-mail do contato.';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.';
  end if;

  if p_id is not null then
    select phone into v_old from public.contacts where id = p_id and company_id = v_company;
    if not found then
      raise exception 'Contato não encontrado.';
    end if;
    v_id := p_id;
  elsif v_phone is not null then
    -- o mesmo número já cadastrado: atualiza o cadastro (com ou sem o 9 do celular)
    select id, phone into v_id, v_old from public.contacts
     where company_id = v_company and public.phone_key(phone) = public.phone_key(v_phone);
  end if;
  if v_phone is not null and exists (
       select 1 from public.contacts where company_id = v_company and id is distinct from v_id
          and public.phone_key(phone) = public.phone_key(v_phone)) then
    raise exception 'Já existe outro contato com este número.';
  end if;

  if v_id is null then
    insert into public.contacts (company_id, name, phone, email, organization, notes, tags, created_by)
    values (v_company, left(v_name, 120), v_phone, left(v_email, 200), left(nullif(btrim(coalesce(p_organization, '')), ''), 120),
            left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), v_tags, auth.uid())
    returning id into v_id;
  else
    update public.contacts
       set name = left(v_name, 120), phone = v_phone, email = left(v_email, 200),
           organization = left(nullif(btrim(coalesce(p_organization, '')), ''), 120),
           notes = left(nullif(btrim(coalesce(p_notes, '')), ''), 2000), tags = v_tags, updated_at = now()
     where id = v_id;
  end if;

  -- conversas com o mesmo número: o nome e as etiquetas do contato
  if v_phone is not null then
    update public.private_chats c
       set name = left(v_name, 120), tags = v_tags
     where c.company_id = v_company and public.phone_key(c.phone) = public.phone_key(v_phone)
       and (c.name is distinct from left(v_name, 120) or c.tags is distinct from v_tags);
  end if;
  return v_id;
end;
$$;
revoke all on function public.save_contact(uuid, text, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.save_contact(uuid, text, text, text, text, text, uuid[]) to authenticated;

create or replace function public.delete_contact(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_use_private_chats() then
    raise exception 'Os contatos não estão liberados para você nesta empresa.' using errcode = '42501';
  end if;
  delete from public.contacts where id = p_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Contato não encontrado.';
  end if;
end;
$$;
revoke all on function public.delete_contact(uuid) from public, anon;
grant execute on function public.delete_contact(uuid) to authenticated;

-- conversa com um número cadastrado: fica com o nome do contato (o WhatsApp não troca a cada
-- mensagem); a conversa nova já entra com as etiquetas dele
create or replace function public.private_chats_contact_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k public.contacts%rowtype;
begin
  if new.phone is null then
    return new;
  end if;
  select * into k from public.contacts
   where company_id = new.company_id and public.phone_key(phone) = public.phone_key(new.phone);
  if k.id is not null then
    new.name := k.name;
    if tg_op = 'INSERT' then
      new.tags := k.tags;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists private_chats_contact_name on public.private_chats;
create trigger private_chats_contact_name before insert or update of name, phone on public.private_chats
  for each row execute function public.private_chats_contact_name();

-- etiqueta excluída: sai dos grupos, das conversas e dos contatos
create or replace function public.customer_tags_cleanup()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.system_notice', 'on', true);
  update public.groups set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  perform set_config('app.system_notice', 'off', true);
  update public.private_chats set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  update public.contacts set tags = array_remove(tags, old.id) where company_id = old.company_id and old.id = any(tags);
  return old;
end;
$$;

-- ------------------------------------------------ a lista: sistema + agenda do WhatsApp + conversas + equipe
create or replace function public.contact_directory(p_search text default null, p_limit int default 5000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_out jsonb;
begin
  if not public.can_use_private_chats() then
    return '[]'::jsonb;
  end if;
  with src as (
    -- cadastrados no sistema (o nome do sistema vale primeiro)
    select coalesce(k.phone || '@s.whatsapp.net', 'contact:' || k.id) as jid, k.phone, k.name, null::text as notify,
           'sistema'::text as origem, 0 as prio, k.id as contact_id, null::uuid as chat_id,
           k.email, k.organization, k.notes, k.tags
      from public.contacts k
     where k.company_id = v_company
    union all
    -- agenda do WhatsApp (nome salvo = prioridade 1)
    select w.jid, w.phone, w.name, w.notify, 'agenda', case when w.name is not null then 1 else 4 end,
           null, null, null, null, null, null
      from public.wa_contacts w
     where w.company_id = v_company
       and w.jid not like '%@g.us' and w.jid not like '%@broadcast' and w.jid not like '%@newsletter'
    union all
    -- conversas privadas (números digitados no sistema e quem escreveu no privado)
    select c.jid, c.phone, c.name, null, 'conversa', case when c.name is not null then 2 else 5 end,
           null, c.id, null, null, null, c.tags
      from public.private_chats c
     where c.company_id = v_company
    union all
    -- pessoas da equipe com WhatsApp
    select t.phone || '@s.whatsapp.net', t.phone, t.name, null, 'equipe', 3, null, null, null, null, null, null
      from public.team_members t
     where t.company_id = v_company and t.active and t.phone is not null
  ), keyed as (
    select s.*, coalesce('p' || public.phone_key(s.phone), 'j' || s.jid) as k from src s
  ), merged as (
    select k,
           (array_agg(name order by prio) filter (where name is not null))[1] as name,
           (array_agg(notify) filter (where notify is not null))[1] as notify,
           (array_agg(phone order by prio) filter (where phone is not null))[1] as phone,
           -- para abrir a conversa: a que já existe, senão pelo número, senão o identificador
           coalesce((array_agg(jid) filter (where origem = 'conversa'))[1],
                    (array_agg(jid) filter (where jid like '%@s.whatsapp.net'))[1],
                    (array_agg(jid))[1]) as jid,
           (array_agg(contact_id) filter (where contact_id is not null))[1] as contact_id,
           (array_agg(chat_id) filter (where chat_id is not null))[1] as chat_id,
           (array_agg(email) filter (where email is not null))[1] as email,
           (array_agg(organization) filter (where organization is not null))[1] as organization,
           (array_agg(notes) filter (where notes is not null))[1] as notes,
           -- etiquetas: as do cadastro; sem cadastro, as da conversa
           coalesce((array_agg(to_jsonb(tags) order by prio) filter (where tags is not null and tags <> '{}'))[1], '[]'::jsonb) as tags,
           bool_or(origem = 'agenda' and name is not null) as na_agenda,
           bool_or(origem = 'conversa') as tem_conversa,
           bool_or(origem = 'equipe') as equipe
      from keyed group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jid', jid, 'phone', phone, 'name', name, 'notify', notify,
           'saved', na_agenda, 'chat', tem_conversa, 'team', equipe,
           'id', contact_id, 'chat_id', chat_id, 'email', email, 'organization', organization, 'notes', notes,
           'tags', tags)
           order by (name is null and notify is null), lower(coalesce(name, notify, phone, jid))), '[]'::jsonb)
    into v_out
    from (
      select * from merged m
       where (v_term is null
              or m.name ilike '%' || v_term || '%' or m.notify ilike '%' || v_term || '%'
              or m.email ilike '%' || v_term || '%' or m.organization ilike '%' || v_term || '%'
              or (v_digits is not null and length(v_digits) >= 3 and m.phone like '%' || v_digits || '%'))
       order by (m.name is null and m.notify is null), lower(coalesce(m.name, m.notify, m.phone, m.jid))
       limit greatest(1, least(coalesce(p_limit, 5000), 20000))
    ) x;
  return v_out;
end;
$$;
grant execute on function public.contact_directory(text, int) to authenticated;

-- ------------------------------------------------ LGPD: o cadastro no sistema entra no pedido do titular
create or replace function public.lgpd_person_export(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits text := public.lgpd_check_admin(p_phone);
  v_jids text[] := public.lgpd_person_jids(v_digits);
  v_key text := public.phone_key(v_digits);
  v_company uuid := public.current_company_id();
  v_res jsonb;
begin
  select jsonb_build_object(
    'gerado_em', now(),
    'empresa', (select name from public.companies where id = v_company),
    'telefone', v_digits,
    'identificadores', to_jsonb(v_jids),
    'participacao_em_grupos', coalesce((select jsonb_agg(jsonb_build_object(
        'grupo', g.name, 'nome', gp.name, 'telefone', gp.phone, 'papel', gp.role, 'entrou_em', gp.joined_at, 'saiu_em', gp.left_at))
        from public.group_participants gp join public.groups g on g.id = gp.group_id
       where gp.company_id = v_company and gp.jid = any(v_jids)), '[]'),
    'contato_no_whatsapp', coalesce((select jsonb_agg(jsonb_build_object('nome_salvo', w.name, 'nome_whatsapp', w.notify, 'telefone', w.phone))
        from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids)), '[]'),
    'mensagens_em_grupos', coalesce((select jsonb_agg(jsonb_build_object(
        'grupo', g.name, 'enviada_em', m.sent_at, 'nome', m.sender_name, 'tipo', m.message_type, 'texto', m.body) order by m.sent_at)
        from public.messages m join public.groups g on g.id = m.group_id
       where g.company_id = v_company and m.anonymized_at is null and not m.from_me
         and (m.sender_jid = any(v_jids) or public.phone_key(m.sender_phone) = v_key)), '[]'),
    'conversas_privadas', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', c.name, 'telefone', c.phone,
        'mensagens', coalesce((select jsonb_agg(jsonb_build_object(
            'enviada_em', pm.sent_at, 'de', case when pm.from_me then 'empresa' else 'titular' end,
            'tipo', pm.message_type, 'texto', pm.body) order by pm.sent_at)
          from public.private_messages pm where pm.chat_id = c.id and pm.anonymized_at is null), '[]')))
        from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids)), '[]'),
    'reacoes', coalesce((select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'em', r.reacted_at))
        from public.message_reactions r where r.company_id = v_company and r.reactor_jid = any(v_jids)), '[]'),
    'cadastro_no_sistema', coalesce((select jsonb_agg(jsonb_build_object(
        'nome', k.name, 'telefone', k.phone, 'email', k.email, 'empresa', k.organization, 'observacoes', k.notes))
        from public.contacts k where k.company_id = v_company and public.phone_key(k.phone) = v_key), '[]')
  ) into v_res;
  perform public.lgpd_log('exportou', v_digits, jsonb_build_object(
    'mensagens', jsonb_array_length(v_res->'mensagens_em_grupos'), 'conversas', jsonb_array_length(v_res->'conversas_privadas')));
  return v_res;
end;
$$;
revoke all on function public.lgpd_person_export(text) from public, anon;
grant execute on function public.lgpd_person_export(text) to authenticated;

create or replace function public.lgpd_person_erase(p_phone text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_digits text := public.lgpd_check_admin(p_phone);
  v_jids text[] := public.lgpd_person_jids(v_digits);
  v_key text := public.phone_key(v_digits);
  v_company uuid := public.current_company_id();
  v_paths text[] := '{}';
  v_part text[];
  v_msgs int := 0;
  v_chats int := 0;
  v_other int;
  v_res jsonb;
begin
  if exists (select 1 from public.team_members t where t.company_id = v_company and public.phone_key(t.phone) = v_key) then
    raise exception 'Este telefone é de um atendente: remova-o da equipe antes (Configurações › Atendentes).';
  end if;
  perform set_config('app.activity_skip', 'on', true);

  -- mensagens dela nos grupos: sai o conteúdo e quem mandou
  with alvo as (
    select m.id, m.media_path as old_path from public.messages m join public.groups g on g.id = m.group_id
     where g.company_id = v_company and not m.from_me
       and (m.sender_jid = any(v_jids) or public.phone_key(m.sender_phone) = v_key)
  ), u as (
    update public.messages m
       set body = null, original_body = null, sender_name = null, sender_phone = null, sender_jid = null,
           quoted_body = null, quoted_sender_jid = null,
           media_path = null, media_status = case when m.media_path is not null then 'expired' else m.media_status end,
           anonymized_at = now()
      from alvo
     where m.id = alvo.id
    returning alvo.old_path
  )
  select count(*), coalesce(array_agg(old_path) filter (where old_path is not null), '{}') into v_msgs, v_part from u;
  v_paths := v_paths || v_part;
  -- citações dela em respostas de outros
  update public.messages m set quoted_body = null, quoted_sender_jid = null
    from public.groups g where g.id = m.group_id and g.company_id = v_company and m.quoted_sender_jid = any(v_jids);

  -- conversas privadas (com as mensagens, reações e envios)
  select coalesce(array_agg(pm.media_path) filter (where pm.media_path is not null), '{}') into v_part
    from public.private_messages pm join public.private_chats c on c.id = pm.chat_id
   where c.company_id = v_company and c.jid = any(v_jids);
  v_paths := v_paths || v_part;
  delete from public.private_chats c where c.company_id = v_company and c.jid = any(v_jids);
  get diagnostics v_chats = row_count;

  delete from public.message_reactions r where r.company_id = v_company and r.reactor_jid = any(v_jids);
  delete from public.message_receipts r where r.company_id = v_company and r.user_jid = any(v_jids);
  delete from public.wa_contacts w where w.company_id = v_company and w.jid = any(v_jids);
  delete from public.contacts k where k.company_id = v_company and public.phone_key(k.phone) = v_key;
  select coalesce(array_agg(a.path) filter (where a.path is not null), '{}') into v_part
    from public.contact_avatars a where a.company_id = v_company and a.jid = any(v_jids);
  v_paths := v_paths || v_part;
  delete from public.contact_avatars a where a.company_id = v_company and a.jid = any(v_jids);
  -- membros: sai nome e telefone (a pessoa segue no grupo do WhatsApp; o worker volta a listá-la se
  -- continuar lá)
  delete from public.group_participants gp where gp.company_id = v_company and gp.jid = any(v_jids);
  get diagnostics v_other = row_count;

  perform set_config('app.activity_skip', 'off', true);
  v_res := jsonb_build_object('mensagens_grupos', v_msgs, 'conversas_privadas', v_chats, 'participacoes', v_other,
                              'arquivos', to_jsonb(v_paths));
  perform public.lgpd_log('apagou', v_digits, v_res - 'arquivos');
  return v_res;
end;
$$;
revoke all on function public.lgpd_person_erase(text) from public, anon;
grant execute on function public.lgpd_person_erase(text) to authenticated;
$mig0112$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0113_contacts_photos.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0113', $mig0113$
-- =====================================================================
-- Contatos com nome e foto.
--
--  * Foto: a lista de contatos traz a foto de perfil do WhatsApp que o
--    worker guarda (agora também dos contatos da agenda e das conversas
--    privadas, não só dos membros dos grupos).
--  * Nome: quem não tem nome salvo na agenda nem no sistema aparece com o
--    nome que usa no WhatsApp; se esse nome não veio com o contato, vale
--    o nome visto nos grupos de que a pessoa participa.
-- =====================================================================

create or replace function public.contact_directory(p_search text default null, p_limit int default 5000)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_term text := nullif(btrim(coalesce(p_search, '')), '');
  v_digits text := nullif(regexp_replace(coalesce(p_search, ''), '\D', '', 'g'), '');
  v_out jsonb;
begin
  if not public.can_use_private_chats() then
    return '[]'::jsonb;
  end if;
  with src as (
    -- cadastrados no sistema (o nome do sistema vale primeiro)
    select coalesce(k.phone || '@s.whatsapp.net', 'contact:' || k.id) as jid, k.phone, k.name, null::text as notify,
           'sistema'::text as origem, 0 as prio, k.id as contact_id, null::uuid as chat_id,
           k.email, k.organization, k.notes, k.tags
      from public.contacts k
     where k.company_id = v_company
    union all
    -- agenda do WhatsApp (nome salvo = prioridade 1)
    select w.jid, w.phone, w.name, w.notify, 'agenda', case when w.name is not null then 1 else 4 end,
           null, null, null, null, null, null
      from public.wa_contacts w
     where w.company_id = v_company
       and w.jid not like '%@g.us' and w.jid not like '%@broadcast' and w.jid not like '%@newsletter'
    union all
    -- conversas privadas (números digitados no sistema e quem escreveu no privado)
    select c.jid, c.phone, c.name, null, 'conversa', case when c.name is not null then 2 else 5 end,
           null, c.id, null, null, null, c.tags
      from public.private_chats c
     where c.company_id = v_company
    union all
    -- pessoas da equipe com WhatsApp
    select t.phone || '@s.whatsapp.net', t.phone, t.name, null, 'equipe', 3, null, null, null, null, null, null
      from public.team_members t
     where t.company_id = v_company and t.active and t.phone is not null
    union all
    -- membros dos grupos: só completam o nome usado no WhatsApp (não entram sozinhos na lista)
    select gp.jid, gp.phone, null, nullif(btrim(gp.name), ''), 'membro', 6, null, null, null, null, null, null
      from public.group_participants gp
     where gp.company_id = v_company and nullif(btrim(gp.name), '') is not null
       and gp.name !~ '^[0-9 +()-]+$'
  ), keyed as (
    select s.*, coalesce('p' || public.phone_key(s.phone), 'j' || s.jid) as k,
           exists (select 1 from public.contact_avatars a
                    where a.company_id = v_company and a.jid = s.jid and a.path is not null) as has_photo
      from src s
  ), merged as (
    select k,
           (array_agg(name order by prio) filter (where name is not null))[1] as name,
           (array_agg(notify order by prio) filter (where notify is not null))[1] as notify,
           (array_agg(phone order by prio) filter (where phone is not null))[1] as phone,
           -- para abrir a conversa: a que já existe, senão pelo número, senão o identificador
           coalesce((array_agg(jid) filter (where origem = 'conversa'))[1],
                    (array_agg(jid) filter (where jid like '%@s.whatsapp.net'))[1],
                    (array_agg(jid) filter (where origem <> 'membro'))[1]) as jid,
           -- a foto de perfil guardada pelo worker (de qualquer identificador da pessoa)
           (array_agg(jid order by prio) filter (where has_photo))[1] as photo_jid,
           (array_agg(contact_id) filter (where contact_id is not null))[1] as contact_id,
           (array_agg(chat_id) filter (where chat_id is not null))[1] as chat_id,
           (array_agg(email) filter (where email is not null))[1] as email,
           (array_agg(organization) filter (where organization is not null))[1] as organization,
           (array_agg(notes) filter (where notes is not null))[1] as notes,
           -- etiquetas: as do cadastro; sem cadastro, as da conversa
           coalesce((array_agg(to_jsonb(tags) order by prio) filter (where tags is not null and tags <> '{}'))[1], '[]'::jsonb) as tags,
           bool_or(origem = 'agenda' and name is not null) as na_agenda,
           bool_or(origem = 'conversa') as tem_conversa,
           bool_or(origem = 'equipe') as equipe,
           bool_or(origem <> 'membro') as listed
      from keyed group by k
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'jid', jid, 'phone', phone, 'name', name, 'notify', notify,
           'saved', na_agenda, 'chat', tem_conversa, 'team', equipe,
           'id', contact_id, 'chat_id', chat_id, 'email', email, 'organization', organization, 'notes', notes,
           'tags', tags, 'photo', photo_jid)
           order by (name is null and notify is null), lower(coalesce(name, notify, phone, jid))), '[]'::jsonb)
    into v_out
    from (
      select * from merged m
       where m.listed and (v_term is null
              or m.name ilike '%' || v_term || '%' or m.notify ilike '%' || v_term || '%'
              or m.email ilike '%' || v_term || '%' or m.organization ilike '%' || v_term || '%'
              or (v_digits is not null and length(v_digits) >= 3 and m.phone like '%' || v_digits || '%'))
       order by (m.name is null and m.notify is null), lower(coalesce(m.name, m.notify, m.phone, m.jid))
       limit greatest(1, least(coalesce(p_limit, 5000), 20000))
    ) x;
  return v_out;
end;
$$;
grant execute on function public.contact_directory(text, int) to authenticated;
$mig0113$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0114_private_chats_per_user.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0114', $mig0114$
-- =====================================================================
-- Conversas privadas por usuário.
--
--  * As conversas privadas deixam de ser só de quem administra a
--    plataforma: administradores e atendentes da empresa (com o módulo
--    ligado) usam. "Somente ver painéis" e "Só agenda" continuam sem.
--  * Cada conversa tem um responsável (assigned_to):
--    - conversa nova de cliente chega "Sem responsável": todos veem e
--      são avisados;
--    - quem responde primeiro (ou clica em Assumir) fica com ela; quem
--      inicia uma conversa já é o responsável;
--    - o responsável pode transferir ou devolver para "Sem responsável";
--      o administrador pode tudo.
--  * Cada usuário vê as suas conversas e as sem responsável; os
--    administradores veem todas.
--  * Avisos (celular e tela): da conversa sem responsável, para todos;
--    da conversa com responsável, só para ele. Transferir avisa quem
--    recebeu.
-- =====================================================================

alter table public.private_chats
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_at timestamptz;
create index if not exists private_chats_assigned_idx on public.private_chats (company_id, assigned_to);

-- quem usa: administradores e atendentes ativos, na empresa com o módulo ligado
create or replace function public.can_use_private_chats()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_active_user()
     and coalesce((select private_chats_enabled from public.companies where id = public.current_company_id()), false)
     and exists (select 1 from public.profiles p where p.id = auth.uid() and (p.platform_admin or p.role in ('admin', 'agent')))
$$;
revoke all on function public.can_use_private_chats() from public, anon;
grant execute on function public.can_use_private_chats() to authenticated;

-- vê as conversas de todos (administradores)
create or replace function public.private_sees_all()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and public.is_admin()
$$;
revoke all on function public.private_sees_all() from public, anon;
grant execute on function public.private_sees_all() to authenticated;

create or replace function public.private_chat_visible(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and exists (
    select 1 from public.private_chats c
     where c.id = p_chat and c.company_id = public.current_company_id()
       and (c.assigned_to is null or c.assigned_to = auth.uid() or public.private_sees_all()))
$$;
revoke all on function public.private_chat_visible(uuid) from public, anon;
grant execute on function public.private_chat_visible(uuid) to authenticated;

create or replace function public.user_display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'outro usuário') from public.profiles where id = p_user
$$;
revoke all on function public.user_display_name(uuid) from public, anon, authenticated;

-- ------------------------------------------------ leitura: as suas, as sem responsável (e todas, para administradores)
drop policy if exists private_chats_read on public.private_chats;
create policy private_chats_read on public.private_chats for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and (assigned_to is null or assigned_to = (select auth.uid()) or (select public.private_sees_all())));
drop policy if exists private_messages_read on public.private_messages;
create policy private_messages_read on public.private_messages for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and chat_id in (select id from public.private_chats));
drop policy if exists private_outgoing_read on public.private_outgoing;
create policy private_outgoing_read on public.private_outgoing for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and chat_id in (select id from public.private_chats));
drop policy if exists private_reactions_read on public.private_reactions;
create policy private_reactions_read on public.private_reactions for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and message_id in (select id from public.private_messages));
drop policy if exists private_actions_read on public.private_actions;
create policy private_actions_read on public.private_actions for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and message_id in (select id from public.private_messages));

-- ------------------------------------------------ envio pelo painel: só na conversa que a pessoa vê; sem responsável, assume
create or replace function public.private_outgoing_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return new;                                   -- worker / sistema
  end if;
  if not public.private_chat_visible(new.chat_id) then
    select assigned_to into v_owner from public.private_chats where id = new.chat_id;
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(v_owner)
      using errcode = '42501';
  end if;
  update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and assigned_to is null;
  return new;
end;
$$;
drop trigger if exists private_outgoing_owner on public.private_outgoing;
create trigger private_outgoing_owner before insert on public.private_outgoing
  for each row execute function public.private_outgoing_owner();

-- editar, apagar e reagir: só na conversa que a pessoa vê
create or replace function public.private_actions_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not exists (
       select 1 from public.private_messages m where m.id = new.message_id and public.private_chat_visible(m.chat_id)) then
    raise exception 'Mensagem não encontrada.' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists private_actions_owner on public.private_actions;
create trigger private_actions_owner before insert on public.private_actions
  for each row execute function public.private_actions_owner();

-- ------------------------------------------------ abrir / iniciar conversa
create or replace function public.start_private_chat(p_jid text default null, p_phone text default null, p_name text default null)
returns public.private_chats language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_instance uuid;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_jid text := nullif(btrim(coalesce(p_jid, '')), '');
  v_contact public.wa_contacts%rowtype;
  v_row public.private_chats;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  select id into v_instance from public.whatsapp_instances
   where company_id = v_company order by (status = 'connected') desc, created_at limit 1;
  if v_instance is null then
    raise exception 'Conecte um WhatsApp em Configurações › WhatsApp.';
  end if;
  if v_jid is null then
    if length(v_phone) between 10 and 11 then
      v_phone := '55' || v_phone;              -- DDD + número: Brasil
    end if;
    if length(v_phone) < 12 or length(v_phone) > 15 then
      raise exception 'Informe o número com DDD (e o código do país, se não for do Brasil).';
    end if;
    v_jid := v_phone || '@s.whatsapp.net';
    -- número digitado: o nome salvo na agenda (com ou sem o 9 do celular)
    select * into v_contact from public.wa_contacts
     where instance_id = v_instance and public.phone_key(phone) = public.phone_key(v_phone)
     order by (name is not null) desc limit 1;
  else
    select * into v_contact from public.wa_contacts where instance_id = v_instance and jid = v_jid;
    if v_contact.name is null and v_contact.phone is not null then
      select coalesce(v_contact.name, w.name) into v_contact.name from public.wa_contacts w
       where w.instance_id = v_instance and w.name is not null and public.phone_key(w.phone) = public.phone_key(v_contact.phone)
       limit 1;
    end if;
    v_phone := coalesce(v_contact.phone, nullif(split_part(v_jid, '@', 1), ''));
    if v_jid like '%@lid' and v_contact.phone is null then
      v_phone := null;
    end if;
  end if;

  insert into public.private_chats (instance_id, company_id, jid, phone, name)
  values (v_instance, v_company, v_jid, v_phone,
          coalesce(nullif(btrim(p_name), ''), v_contact.name, v_contact.notify))
  on conflict (instance_id, jid) do update
    set name = coalesce(public.private_chats.name, excluded.name),
        phone = coalesce(public.private_chats.phone, excluded.phone)
  returning * into v_row;
  -- quem inicia a conversa fica com ela; a de outro usuário só o administrador abre
  if v_row.assigned_to is null then
    update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
     where id = v_row.id returning * into v_row;
  elsif v_row.assigned_to <> auth.uid() and not public.private_sees_all() then
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(v_row.assigned_to);
  end if;
  return v_row;
end;
$$
;
revoke all on function public.start_private_chat(text, text, text) from public, anon;
grant execute on function public.start_private_chat(text, text, text) to authenticated;

create or replace function public.mark_private_chat_read(p_chat_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.private_chats set unread_count = 0
   where id = p_chat_id and public.private_chat_visible(p_chat_id);
$$;

create or replace function public.set_private_chat_tags(p_chat uuid, p_tags uuid[])
returns uuid[] language plpgsql security definer set search_path = public as $$
declare
  v_tags uuid[] := public.clean_customer_tags(p_tags);
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  update public.private_chats set tags = v_tags where id = p_chat;
  return v_tags;
end;
$$;
revoke all on function public.set_private_chat_tags(uuid, uuid[]) from public, anon;
grant execute on function public.set_private_chat_tags(uuid, uuid[]) to authenticated;

-- ------------------------------------------------ assumir, transferir e devolver
-- p_user: o novo responsável (null = volta para "Sem responsável")
create or replace function public.assign_private_chat(p_chat uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  select * into c from public.private_chats where id = p_chat;
  -- sem responsável: qualquer um assume (ou passa para alguém); com responsável: ele ou um administrador
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador muda o responsável desta conversa.' using errcode = '42501';
  end if;
  if p_user is not null and not exists (
       select 1 from public.profiles p
        where p.id = p_user and p.company_id = c.company_id and p.active
          and (p.platform_admin or p.role in ('admin', 'agent'))) then
    raise exception 'Escolha um administrador ou atendente ativo da empresa.';
  end if;
  if p_user is not distinct from c.assigned_to then
    return;
  end if;
  update public.private_chats set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end
   where id = p_chat;
  -- quem recebeu a conversa de outra pessoa é avisado
  if p_user is not null and p_user <> v_me then
    perform public.queue_push(
      c.company_id, 'private', 'users',
      '💬 Conversa transferida para você',
      coalesce(nullif(btrim(c.name), ''), c.phone, 'Conversa privada') || ' · por ' || public.user_display_name(v_me),
      '/private?c=' || c.id, null, array[p_user], 'private:' || c.id, null);
  end if;
end;
$$;
revoke all on function public.assign_private_chat(uuid, uuid) from public, anon;
grant execute on function public.assign_private_chat(uuid, uuid) to authenticated;

-- quem pode receber uma conversa (para o "Transferir")
create or replace function public.private_chat_agents()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', public.user_display_name(p.id)) order by lower(public.user_display_name(p.id))), '[]'::jsonb)
    from public.profiles p
   where public.can_use_private_chats() and p.company_id = public.current_company_id() and p.active
     and (p.platform_admin or p.role in ('admin', 'agent'))
$$;
grant execute on function public.private_chat_agents() to authenticated;

-- ------------------------------------------------ aviso no celular: sem responsável, para todos; com responsável, só ele
create or replace function public.private_messages_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_title text;
  v_body text;
begin
  if new.from_me or new.sent_at < now() - interval '10 minutes' then
    return new;
  end if;
  select * into c from public.private_chats where id = new.chat_id;
  if not coalesce((select private_chats_enabled from public.companies where id = new.company_id), false) then
    return new;
  end if;
  v_title := '💬 ' || coalesce(nullif(btrim(c.name), ''), nullif(btrim(new.sender_name), ''), c.phone, 'Conversa privada');
  v_body := case new.message_type when 'text' then left(coalesce(new.body, ''), 160)
                                  when 'audio' then '🎤 Áudio' when 'image' then '📷 Imagem'
                                  when 'document' then '📄 Documento' when 'video' then '🎬 Vídeo'
                                  else coalesce(left(new.body, 160), 'Nova mensagem') end;
  if c.assigned_to is null then
    perform public.queue_push(new.company_id, 'private', 'private', v_title, v_body,
      '/private?c=' || new.chat_id, null, '{}', 'private:' || new.chat_id);
  else
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null, array[c.assigned_to], 'private:' || new.chat_id);
  end if;
  return new;
end;
$$;
$mig0114$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0115_dashboard_speed.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0115', $mig0115$
-- =====================================================================
-- Dashboard mais rápido.
--
--  * Busca por palavras (pergunta, pedido, urgência, agradecimento,
--    encerramento, categorias): a expressão de cada lista é montada uma
--    vez, e não a cada mensagem; as funções ficam em SQL simples para o
--    banco embutir na consulta. O resultado é o mesmo de antes.
--  * Tipo de demanda: a contagem das mensagens por categoria era refeita
--    para cada categoria; agora é feita uma vez.
--  * Conversas (início e fechamento, conversas por dia, resumo da
--    gestão): a lista de conversas do período é calculada uma vez por
--    carregamento e reaproveitada; a classificação das mensagens vai na
--    própria consulta.
--  * Horários de pico e dia hora a hora: contagens feitas de uma vez.
--  * Cada indicador é calculado uma vez por carregamento (os
--    indicadores e o resumo da gestão usam os mesmos números).
--  * dashboard_bundle(): indicadores + resumo da gestão de um período
--    numa chamada só (o painel faz 2 chamadas em vez de 4); a do período
--    de comparação calcula só os números.
--  * Índice para achar a última mensagem da equipe em cada grupo.
-- =====================================================================

create index if not exists messages_group_team_sent_idx on public.messages (group_id, sent_at desc) where from_team;

-- ------------------------------------------------ busca por palavras
-- expressão com todas as palavras de uma lista (null = lista vazia). Montada uma vez por lista e
-- guardada na sessão (a chave é o conteúdo da lista: mudou a lista, muda a chave); dentro de uma
-- consulta com a lista fixa, o banco calcula uma vez só.
create or replace function public.kw_pattern(p_keywords jsonb)
returns text language plpgsql immutable as $$
declare
  v_key text;
  v_alt text;
begin
  if jsonb_typeof(p_keywords) is distinct from 'array' or jsonb_array_length(p_keywords) = 0 then
    return null;
  end if;
  v_key := 'mgkw.k' || md5(p_keywords::text);
  v_alt := current_setting(v_key, true);
  if v_alt is null or v_alt = '' then
    select string_agg(regexp_replace(public.norm_text(btrim(e.value)), '([^[:alnum:] ])', '\\\1', 'g'), '|')
      into v_alt
      from jsonb_array_elements(p_keywords) as x(item), lateral (select x.item #>> '{}' as value) e
     where jsonb_typeof(x.item) = 'string' and btrim(e.value) <> '';
    v_alt := case when v_alt is null then '-' else '(^|[^[:alnum:]])(' || v_alt || ')($|[^[:alnum:]])' end;
    perform set_config(v_key, v_alt, false);
  end if;
  return nullif(v_alt, '-');
end;
$$;

-- a palavra da lista que aparece primeiro na ordem da lista (só é chamada quando alguma aparece)
create or replace function public.match_keyword_first(p_text text, p_keywords jsonb)
returns text language plpgsql immutable as $$
declare
  v_text text := public.norm_text(p_text);
  k record;
begin
  for k in
    select e.value
    from jsonb_array_elements_text(p_keywords) with ordinality as e(value, ord)
    where btrim(e.value) <> ''
    order by e.ord
  loop
    if v_text ~ ('(^|[^[:alnum:]])'
                 || regexp_replace(public.norm_text(btrim(k.value)), '([^[:alnum:] ])', '\\\1', 'g')
                 || '($|[^[:alnum:]])') then
      return k.value;
    end if;
  end loop;
  return null;
end;
$$;

-- qual palavra da lista aparece no texto (sem acento e sem diferença de maiúsculas; palavra inteira).
-- Em SQL simples (sem search_path próprio) para o banco embutir na consulta: a maioria das mensagens
-- para no primeiro teste.
create or replace function public.match_keyword(p_text text, p_keywords jsonb)
returns text language sql immutable as $$
  select case
    when p_text is null or public.kw_pattern(p_keywords) is null then null
    when public.norm_text(p_text) !~ public.kw_pattern(p_keywords) then null
    else public.match_keyword_first(p_text, p_keywords)
  end
$$;

-- expressão com as palavras de todas as categorias (guardada na sessão, como em kw_pattern)
create or replace function public.category_pattern(p_categories jsonb)
returns text language plpgsql immutable as $$
declare
  v_key text;
  v_all jsonb;
  v_pat text;
begin
  if jsonb_typeof(p_categories) is distinct from 'array' or jsonb_array_length(p_categories) = 0 then
    return null;
  end if;
  v_key := 'mgkw.c' || md5(p_categories::text);
  v_pat := current_setting(v_key, true);
  if v_pat is null or v_pat = '' then
    select coalesce(jsonb_agg(k.value), '[]'::jsonb) into v_all
      from jsonb_array_elements(p_categories) cat(value),
           jsonb_array_elements(case when jsonb_typeof(cat.value->'keywords') = 'array' then cat.value->'keywords' else '[]'::jsonb end) k(value)
     where nullif(btrim(cat.value->>'name'), '') is not null and jsonb_typeof(k.value) = 'string';
    v_pat := coalesce(public.kw_pattern(v_all), '-');
    perform set_config(v_key, v_pat, false);
  end if;
  return nullif(v_pat, '-');
end;
$$;

create or replace function public.match_category_first(p_text text, p_categories jsonb)
returns text language sql immutable as $$
  select c.value->>'name'
  from jsonb_array_elements(p_categories) with ordinality as c(value, ord)
  where nullif(btrim(c.value->>'name'), '') is not null
    and public.match_keyword(p_text, c.value->'keywords') is not null
  order by c.ord
  limit 1
$$;

-- a primeira categoria (na ordem da lista) com alguma palavra no texto; antes, um teste só com as
-- palavras de todas as categorias
create or replace function public.match_category(p_text text, p_categories jsonb)
returns text language sql immutable as $$
  select case
    when p_text is null or public.category_pattern(p_categories) is null then null
    when public.norm_text(p_text) !~ public.category_pattern(p_categories) then null
    else public.match_category_first(p_text, p_categories)
  end
$$;

create or replace function public.reply_signal(p_body text, p_type text, p jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $$
  select case
    when p_type in ('sticker', 'reaction') then 'closing'
    when p_type = 'audio' then 'audio'
    when nullif(btrim(coalesce(p_body, '')), '') is null then
      case when p_type in ('image', 'video', 'document') then 'media' else 'plain' end
    when public.match_keyword(p_body, p->'urgent_keywords') is not null then 'urgent'
    when p_body ~ '[?¿]'
      or public.norm_text(btrim(p_body)) ~ ('^(quem|qual|quais|quando|onde|como|quanto|quantos|quantas|por que|porque|pq|'
           || 'sera que|alguem|voces|vcs|tem como|teria como|consegue|conseguem|poderia|poderiam|pode(?! deixar)|podem|'
           || 'da pra|da para|e possivel|seria possivel|existe|ha como|tem previsao)([^[:alnum:]]|$)') then 'question'
    when public.match_keyword(p_body, p->'request_keywords') is not null then 'request'
    when public.norm_text(btrim(p_body)) ~ ('^(bom dia|boa tarde|boa noite|oi+|ola|opa|e ai|salve|oie)'
           || '([ ,!.]+(pessoal|a todos|todos|gente|galera|tudo bem|tudo bom|como vai))*[ !.,]*$') then 'greeting'
    when public.match_keyword(p_body, p->'closing_keywords') is not null and length(btrim(p_body)) <= 80 then 'closing'
    -- só emojis/pontuação
    when p_body !~ '[[:alnum:]]' then 'closing'
    -- risadas
    when public.norm_text(btrim(p_body)) ~ '^((k|ha|he|hi|rs|ks)+[ !.]*)+$' then 'social'
    else 'plain'
  end
$$;

create or replace function public.team_close_kind(p_body text, p jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $$
  select case
    when nullif(btrim(coalesce(p_body, '')), '') is null then null
    when public.match_keyword(p_body, p->'commitment_keywords') is not null then 'compromisso'
    when public.match_keyword(p_body, p->'team_closing_keywords') is not null then 'encerramento'
  end
$$;

-- ------------------------------------------------ tipo de demanda
create or replace function public.ind_tipo_demanda(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with cats as (
    select c.value->>'name' as name, c.ord
    from jsonb_array_elements(coalesce(p->'categories', '[]'::jsonb)) with ordinality c(value, ord)
    where nullif(btrim(c.value->>'name'), '') is not null
  ),
  d as materialized (select coalesce(nullif(btrim(type), ''), 'Sem tipo') as name, count(*) as n
        from public.ind_demand_scope(f) where status <> 'cancelada' group by 1),
  -- uma vez só (sem "materialized", a contagem era refeita para cada categoria)
  m as materialized (
    select public.match_category(body, p->'categories') as name, count(*) as n
    from public.ind_scope(f)
    where not from_team and message_type = 'text' and body is not null
    group by 1
  ),
  labels as (
    select name, ord from cats
    union all
    select name, 1000 from d where name not in (select name from cats) and name <> 'Sem tipo'
    union all
    select 'Sem tipo', 2000 where exists (select 1 from d where name = 'Sem tipo')
  )
  -- tabela (e não gráfico): demandas e mensagens têm escalas muito diferentes
  select jsonb_build_object(
    'visual', 'table',
    'columns', jsonb_build_array(
      jsonb_build_object('key', 'label', 'label', 'Categoria'),
      jsonb_build_object('key', 'demands', 'label', 'Demandas', 'format', 'number', 'align', 'right', 'bar', true),
      jsonb_build_object('key', 'messages', 'label', 'Mensagens', 'format', 'number', 'align', 'right', 'bar', true)
    ),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'label', l.name,
        'demands', coalesce((select n from d where d.name = l.name), 0),
        'messages', coalesce((select n from m where m.name = l.name), 0)
      ) order by l.ord, l.name)
      from labels l
    ), '[]'::jsonb)
  )
$$;

-- ------------------------------------------------ horários de pico e dia hora a hora: contagens de uma vez
create or replace function public.ind_horarios_pico(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with m as materialized (
    select extract(isodow from sent_at at time zone (f->>'tz'))::int as dw,   -- 1 = segunda ... 7 = domingo
           extract(hour from sent_at at time zone (f->>'tz'))::int as hr,
           public.is_business_time(sent_at, f) as in_business
    from public.ind_scope(f) where not from_team
  ),
  days as (
    select d, (array['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'])[d] as short,
           (array['segunda','terça','quarta','quinta','sexta','sábado','domingo'])[d] as long
    from generate_series(1, 7) d
  ),
  -- contadas de uma vez (antes, uma contagem por dia e hora)
  cnt as (select dw, hr, count(*)::int as n from m group by dw, hr),
  grid as (
    select days.d, hs.h, coalesce(cnt.n, 0) as n
    from days cross join generate_series(0, 23) as hs(h)
    left join cnt on cnt.dw = days.d and cnt.hr = hs.h
  ),
  by_hour as (select h, sum(n)::int as n from grid group by h),
  by_day as (select d, sum(n)::int as n from grid group by d),
  tot as (select count(*)::int as n, count(*) filter (where not in_business)::int as outside from m),
  -- pico = hora do dia com mais mensagens somando todos os dias (o mesmo destacado no gráfico)
  peak as (select h, n from by_hour order by n desc, h limit 1),
  peak_hour_day as (
    select g.d from grid g, peak where g.h = peak.h order by g.n desc, g.d limit 1
  ),
  peak_day as (select d, n from by_day order by n desc, d limit 1),
  -- faixa de 2 horas seguidas mais movimentada (no dia típico)
  peak_window as (
    select h, n + coalesce((select b2.n from by_hour b2 where b2.h = b1.h + 1), 0) as n2
    from by_hour b1 where h < 23 order by 2 desc, h limit 1
  ),
  bh as (
    select extract(hour from (f->>'business_start')::time)::int as start_h,
           ceil(extract(epoch from (f->>'business_end')::time) / 3600)::int as end_h
  )
  select jsonb_build_object(
    'visual', 'heatmap',
    'rows', (select jsonb_agg(short order by d) from days),
    'cols', (select jsonb_agg(lpad(h::text, 2, '0') || 'h' order by h) from generate_series(0, 23) h),
    'values', (select jsonb_agg(r order by d) from (select d, jsonb_agg(n order by h) as r from grid group by d) x),
    'total', (select n from tot),
    'by_hour', (select jsonb_agg(jsonb_build_object('label', lpad(h::text, 2, '0') || 'h', 'value', n) order by h) from by_hour),
    'by_day', (select jsonb_agg(jsonb_build_object('label', days.short, 'value', by_day.n) order by days.d)
               from by_day join days using (d)),
    'business', (select jsonb_build_object('start_hour', start_h, 'end_hour', end_h,
                   'days', coalesce(f->'business_days', '[]'::jsonb)) from bh),
    'highlights', case when (select n from tot) = 0 then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object(
        'label', 'Horário de pico',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 1)::text, 2, '0') || 'h' from peak),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens · mais forte ' ||
                          (select case when days.d in (6, 7) then 'no ' else 'na ' end || days.long from peak_hour_day join days using (d))
                   from peak)),
      jsonb_build_object(
        'label', 'Faixa mais movimentada',
        'value', (select lpad(h::text, 2, '0') || 'h às ' || lpad((h + 2)::text, 2, '0') || 'h' from peak_window),
        'detail', (select round(100.0 * n2 / nullif((select n from tot), 0)) || '% das mensagens do período' from peak_window)),
      jsonb_build_object(
        'label', 'Dia mais movimentado',
        'value', (select initcap(days.long) from peak_day join days using (d)),
        'detail', (select round(100.0 * n / nullif((select n from tot), 0)) || '% das mensagens' from peak_day)),
      jsonb_build_object(
        'label', 'Fora do expediente',
        'value', (select round(100.0 * outside / nullif(n, 0)) || '%' from tot),
        'detail', (select outside || ' de ' || n || ' mensagens' from tot),
        'tone', (select case when 100.0 * outside / nullif(n, 0) >= 30 then 'warning' end from tot))
    ) end,
    'hint', case when (select n from tot) = 0 then 'Sem mensagens de clientes no período'
                 else (select n || ' mensagens de clientes no período' from tot) end
  )
$$;

create or replace function public.ind_dia_hora_a_hora(f jsonb, p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $$
  with s as (select * from public.ind_slots(f)),
  -- mensagens de cliente no período, com quando a equipe respondeu no grupo
  c as materialized (
    select m.sent_at at time zone (f->>'tz') as lt,
           (select min(t.sent_at) from public.messages t
             where t.group_id = m.group_id and t.from_team and t.sent_at >= m.sent_at) at time zone (f->>'tz') as ans_lt,
           m.opens_pending
    from public.ind_scope(f) m
    where not m.from_team
  ),
  -- respostas da equipe (as mesmas de ind_responses, só com a hora: sem calcular o horário comercial de cada uma)
  r as materialized (
    select m.sent_at at time zone (f->>'tz') as lt
    from public.ind_scope(f) m
    where m.from_team and m.response_time_seconds is not null
      and ((f->>'member_id') is null or m.team_member_id = (f->>'member_id')::uuid)
  ),
  rc as (select s.t0, count(r.lt)::int as n from public.ind_slots(f) s left join r on r.lt >= s.t0 and r.lt < s.t1 group by s.t0),
  cc as (select s.t0, count(c.lt)::int as n from public.ind_slots(f) s left join c on c.lt >= s.t0 and c.lt < s.t1 group by s.t0),
  v as (
    select s.x, s.t0, s.hourly,
           (select n from cc where cc.t0 = s.t0) as received,
           (select n from rc where rc.t0 = s.t0) as answered,
           -- pendentes ao fim da faixa (ou agora, na faixa em andamento)
           (select count(*) from c where c.opens_pending and c.lt < s.t1
                                     and (c.ans_lt is null or c.ans_lt >= least(s.t1, now() at time zone (f->>'tz'))))::int as pending
    from s
  ),
  peak as (select x, received from v order by received desc, t0 limit 1)
  select jsonb_build_object(
    -- um dia: barras por hora; vários dias: linha por dia
    'visual', case when (select hourly from v limit 1) then 'bars' else 'series' end,
    'format', 'number',
    'hint', case when (select sum(received) from v) = 0 then 'Nenhuma mensagem de cliente no período'
                 else 'Pico: ' || (select case when (select hourly from v limit 1) then x else to_char(x::date, 'DD/MM') end from peak)
                      || ' (' || (select received from peak) || ' recebidas) · '
                      || (select sum(received) from v) || ' recebidas · ' || (select sum(answered) from v) || ' respostas' end,
    'series', jsonb_build_array(
      jsonb_build_object('key', 'received', 'label', 'Recebidas'),
      jsonb_build_object('key', 'answered', 'label', 'Respostas da equipe'),
      jsonb_build_object('key', 'pending', 'label', case when (select hourly from v limit 1)
                                                         then 'Pendentes no fim da hora' else 'Pendentes no fim do dia' end)
    ),
    'data', coalesce((select jsonb_agg(jsonb_build_object('x', x, 'label', x, 'received', received, 'answered', answered, 'pending', pending)
                                       order by t0) from v), '[]'::jsonb)
  )
$$;

-- ------------------------------------------------ conversas: calculadas uma vez por carregamento
create or replace function public.ind_conversations_calc(f jsonb, p jsonb)
 RETURNS TABLE(group_id uuid, group_name text, started_at timestamp with time zone, started_by text, starter text, start_body text, first_team_at timestamp with time zone, status text, closed_at timestamp with time zone, closed_by text, closer text, close_body text, last_at timestamp with time zone, msgs integer, returned_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  -- palavras de pergunta/pedido/urgência/encerramento do cliente vêm da análise "Precisa de resposta?"
  v_sig_p jsonb := coalesce((select i.params from public.my_indicators i where i.key = 'analise_sem_resposta'), '{}'::jsonb)
                   || case when jsonb_typeof(p->'client_closing_keywords') = 'array'
                                and jsonb_array_length(p->'client_closing_keywords') > 0
                           then jsonb_build_object('closing_keywords', p->'client_closing_keywords') else '{}'::jsonb end;
  v_idle interval := make_interval(hours => coalesce((p->>'idle_hours')::int, 24));
  v_team_starts boolean := coalesce((p->>'team_can_start')::boolean, true);
  m record;
  v_group uuid := null;
  v_open boolean := false;
  v_sig text;
  v_kind text;
  -- o grupo tem compromisso de retorno ainda não cumprido (a próxima mensagem da equipe é o retorno)
  v_awaiting_return boolean := false;
begin
  for m in
    select s.group_id as gid, s.group_name as gname, s.from_team, s.body, s.message_type, s.sent_at,
           coalesce(tm.name, s.sender_name, s.sender_phone, case when s.from_me then 'Número conectado' end,
                    case when s.from_team then 'Equipe' else 'Cliente' end) as who,
           -- a classificação de cada mensagem vai na própria consulta (bem mais rápido que uma a uma no laço)
           case when s.from_team then public.team_close_kind(s.body, p) end as kind,
           case when not s.from_team then public.reply_signal(s.body, s.message_type, v_sig_p) end as sig
    from public.ind_scope(f) s
    left join public.team_members tm on tm.id = s.team_member_id
    order by s.group_id, s.sent_at
  loop
    -- mudou de grupo: a conversa aberta do grupo anterior termina como está
    if v_group is distinct from m.gid then
      if v_open then
        status := case when now() - last_at > v_idle then 'sem_fechamento' else 'aberta' end;
        return next;
      end if;
      v_group := m.gid;
      v_open := false;
      v_awaiting_return := false;
    end if;

    -- grupo parado além do limite: a conversa ficou sem fechamento
    if v_open and m.sent_at - last_at > v_idle then
      status := 'sem_fechamento';
      return next;
      v_open := false;
    end if;

    v_kind := m.kind;
    v_sig := m.sig;

    if not v_open then
      -- a primeira mensagem da equipe depois de um compromisso é o retorno, não uma conversa nova
      if v_awaiting_return then
        v_awaiting_return := false;
        if m.from_team then
          continue;
        end if;
      end if;
      -- começa uma conversa: mensagem do cliente que não seja agradecimento/risada,
      -- ou da equipe (se permitido) que não seja encerramento/compromisso
      if (not m.from_team and v_sig not in ('closing', 'social'))
         or (m.from_team and v_team_starts and v_kind is null) then
        v_open := true;
        group_id := m.gid; group_name := m.gname; started_at := m.sent_at;
        started_by := case when m.from_team then 'equipe' else 'cliente' end;
        starter := m.who; start_body := m.body;
        first_team_at := case when m.from_team then m.sent_at end;
        closed_at := null; closed_by := null; closer := null; close_body := null; returned_at := null;
        last_at := m.sent_at; msgs := 1;
      end if;
      continue;
    end if;

    msgs := msgs + 1;
    last_at := m.sent_at;
    if m.from_team and first_team_at is null and started_by = 'cliente' then
      first_team_at := m.sent_at;
    end if;

    if (m.from_team and v_kind is not null)
       -- o cliente encerra depois de a equipe ter participado (ou numa conversa iniciada pela equipe)
       or (not m.from_team and v_sig = 'closing' and (first_team_at is not null or started_by = 'equipe')) then
      status := case when v_kind = 'compromisso' then 'compromisso' else 'encerrada' end;
      closed_at := m.sent_at;
      closed_by := case when m.from_team then 'equipe' else 'cliente' end;
      closer := m.who;
      close_body := m.body;
      if status = 'compromisso' then
        -- a equipe voltou a falar no grupo depois do compromisso?
        select min(x.sent_at) into returned_at from public.messages x
        where x.group_id = m.gid and x.from_team and x.sent_at > m.sent_at;
      end if;
      return next;
      v_open := false;
      v_awaiting_return := status = 'compromisso';
    end if;
  end loop;

  if v_open then
    status := case when now() - last_at > v_idle then 'sem_fechamento' else 'aberta' end;
    return next;
  end if;
end;
$$;

create or replace function public.ind_conversations(f jsonb, p jsonb)
returns table(group_id uuid, group_name text, started_at timestamptz, started_by text, starter text, start_body text, first_team_at timestamptz, status text, closed_at timestamptz, closed_by text, closer text, close_body text, last_at timestamptz, msgs integer, returned_at timestamptz)
language plpgsql stable set search_path = public as $$
declare
  -- guardada só durante o carregamento (transação) de quem pediu
  v_key text := 'mgconv.k' || md5(f::text || '|' || coalesce(p::text, '') || '|' || coalesce(auth.uid()::text, ''));
  v text := current_setting(v_key, true);
begin
  if v is null or v = '' then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)::text into v from public.ind_conversations_calc(f, p) c;
    perform set_config(v_key, v, true);
  end if;
  return query select * from jsonb_to_recordset(v::jsonb) as x(group_id uuid, group_name text, started_at timestamptz, started_by text, starter text, start_body text, first_team_at timestamptz, status text, closed_at timestamptz, closed_by text, closer text, close_body text, last_at timestamptz, msgs integer, returned_at timestamptz);
end;
$$;

-- ------------------------------------------------ cada indicador uma vez por carregamento
create or replace function public.ind_cached(p_key text, f jsonb, p jsonb)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_name text := 'mgind.k' || md5(p_key || '|' || f::text || '|' || coalesce(p::text, '') || '|' || coalesce(auth.uid()::text, ''));
  v text := current_setting(v_name, true);
  d jsonb;
begin
  if v is not null and v <> '' then
    return nullif(v, 'null')::jsonb;
  end if;
  execute format('select public.%I($1, $2)', 'ind_' || p_key) into d using f, p;
  perform set_config(v_name, coalesce(d::text, 'null'), true);
  return d;
end;
$$;
revoke all on function public.ind_cached(text, jsonb, jsonb) from public, anon;
grant execute on function public.ind_cached(text, jsonb, jsonb) to authenticated, service_role;

create or replace function public.indicator_values(p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  v_f      jsonb;
  v_ind    record;
  v_data   jsonb;
  v_result jsonb := '[]'::jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_f := public.indicator_filters(p_from, p_to, p_group_id, p_member_id);

  for v_ind in
    select i.*, b.name as block_name, b.position as block_position
    from public.my_indicators i join public.my_indicator_blocks b on b.key = i.block_key
    where i.enabled and b.enabled
      -- comparação do dashboard (dashboard_bundle "só números"): só os indicadores de número
      and (current_setting('mg.kpi_only', true) is distinct from 'on' or i.visual = 'kpi')
    order by b.position, i.position
  loop
    begin
      v_data := public.ind_cached(v_ind.key, v_f, v_ind.params);
    exception when others then
      v_data := jsonb_build_object('visual', 'error', 'message', sqlerrm);
    end;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'key', v_ind.key, 'name', v_ind.name, 'description', v_ind.description,
      'block_key', v_ind.block_key, 'block_name', v_ind.block_name,
      'size', v_ind.size, 'has_details', v_ind.has_details, 'data', v_data
    ));
  end loop;

  return v_result;
end;
$$;

create or replace function public.management_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_group_id uuid DEFAULT NULL::uuid, p_member_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $$
declare
  f      jsonb;
  v_kpi  jsonb := '{}'::jsonb;
  v_key  text;
  v_data jsonb;
  v_panel jsonb;
  v_flow  jsonb;
begin
  if not public.is_active_user() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  f := public.indicator_filters(p_from, p_to, p_group_id, p_member_id);

  -- indicadores reaproveitados (valor e tom), mesmo desligados no dashboard
  foreach v_key in array array['tempo_primeira_resposta', 'taxa_resposta_sla', 'prazo_prometido_cumprido',
                               'conversas_ciclo', 'grupos_silenciosos', 'tempo_resolucao'] loop
    begin
      v_data := public.ind_cached(v_key, f, (select params from public.my_indicators where key = v_key));
      v_kpi := v_kpi || jsonb_build_object(v_key, jsonb_build_object(
        'value', v_data->'value', 'tone', v_data->'tone', 'hint', v_data->'hint', 'secondary', v_data->'secondary',
        'trend', v_data->'trend'->'data'));
    exception when others then
      v_kpi := v_kpi || jsonb_build_object(v_key, jsonb_build_object('value', null));
    end;
  end loop;

  -- fluxo de mensagens (por hora num dia, por dia em vários): recebidas x respostas
  begin
    -- a comparação do dashboard ("só números") não mostra o fluxo
    if current_setting('mg.kpi_only', true) is distinct from 'on' then
      v_flow := public.ind_cached('dia_hora_a_hora', f, (select params from public.my_indicators where key = 'dia_hora_a_hora'));
    end if;
  exception when others then
    v_flow := null;
  end;

  -- situação dos grupos agora (mesma regra do painel de grupos)
  v_panel := coalesce((
    select jsonb_agg(g) from jsonb_array_elements(public.groups_panel()) g
    where p_group_id is null or (g->>'id')::uuid = p_group_id
  ), '[]'::jsonb);

  return jsonb_build_object(
    -- atendimento no período
    'client_messages', (select count(*) from public.ind_scope(f) m where not m.from_team),
    'team_replies', (select count(*) from public.ind_scope(f) m
                      where m.from_team and (p_member_id is null or m.team_member_id = p_member_id)),
    'first_response', v_kpi->'tempo_primeira_resposta',
    'sla_rate', v_kpi->'taxa_resposta_sla',
    'sla_target', (select (params->>'target_percent')::numeric from public.my_indicators where key = 'taxa_resposta_sla'),
    -- situação agora
    'groups_waiting', (select count(*) from jsonb_array_elements(v_panel) g where g->>'status' in ('waiting', 'late')),
    'groups_late', (select count(*) from jsonb_array_elements(v_panel) g where g->>'status' = 'late'),
    'pending_messages', (select coalesce(sum((g->>'pending_count')::int), 0) from jsonb_array_elements(v_panel) g),
    'alerts_open', (select count(*) from public.alerts a
                     where a.status <> 'resolved' and (p_group_id is null or a.group_id = p_group_id)),
    'alerts_critical', (select count(*) from public.alerts a
                         where a.status <> 'resolved' and a.severity = 'critical'
                           and (p_group_id is null or a.group_id = p_group_id)),
    'whatsapp', (select case when bool_or(status = 'connected') then 'connected'
                             when count(*) = 0 then 'none' else 'disconnected' end
                 from public.whatsapp_instances),
    -- demandas
    'demands_open', (select count(*) from public.demands d
                      where d.status in ('aberta', 'em_andamento')
                        and (p_group_id is null or d.group_id = p_group_id)
                        and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_overdue', (select count(*) from public.demands d
                         where d.status in ('aberta', 'em_andamento') and d.promised_at < now()
                           and (p_group_id is null or d.group_id = p_group_id)
                           and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_created', (select count(*) from public.demands d
                         where d.opened_at >= p_from and d.opened_at < p_to
                           and (p_group_id is null or d.group_id = p_group_id)
                           and (p_member_id is null or d.assignee_id = p_member_id)),
    'demands_delivered', (select count(*) from public.demands d
                           where d.delivered_at >= p_from and d.delivered_at < p_to
                             and (p_group_id is null or d.group_id = p_group_id)
                             and (p_member_id is null or d.assignee_id = p_member_id)),
    'promise_kept', v_kpi->'prazo_prometido_cumprido',
    'resolution_time', v_kpi->'tempo_resolucao',
    -- conversas e grupos
    'conversations', v_kpi->'conversas_ciclo',
    -- fechadas = encerradas + compromisso de retorno (mesma regra do indicador)
    'conversations_closed_rate', (
      select case when coalesce((v_kpi->'conversas_ciclo'->>'value')::numeric, 0) = 0 then null
                  else round(100.0 * coalesce(sum((x->>'value')::numeric), 0)
                             / (v_kpi->'conversas_ciclo'->>'value')::numeric, 1) end
      from jsonb_array_elements(coalesce(v_kpi->'conversas_ciclo'->'secondary', '[]'::jsonb)) x
      where x->>'label' in ('Encerradas', 'Compromisso de retorno')),
    'groups_active', (select count(distinct m.group_id) from public.ind_scope(f) m),
    'groups_monitored', (select count(*) from public.groups g
                          where g.monitored and g.removed_at is null and (p_group_id is null or g.id = p_group_id)),
    'groups_silent', v_kpi->'grupos_silenciosos',
    'flow', coalesce(v_flow->'data', '[]'::jsonb),
    'flow_hourly', coalesce(v_flow->>'visual' = 'bars', false)
  );
end;
$$;

-- indicadores + resumo da gestão de um período numa chamada só (os dois aproveitam os mesmos cálculos).
-- p_kpi_only: período de comparação, que só usa os números (sem gráficos, tabelas e listas)
create or replace function public.dashboard_bundle(p_from timestamptz, p_to timestamptz, p_group_id uuid default null,
                                                   p_member_id uuid default null, p_kpi_only boolean default false)
returns jsonb language plpgsql stable set search_path = public as $$
begin
  perform set_config('mg.kpi_only', case when p_kpi_only then 'on' else 'off' end, true);
  return jsonb_build_object(
    'indicators', public.indicator_values(p_from, p_to, p_group_id, p_member_id),
    'summary', public.management_summary(p_from, p_to, p_group_id, p_member_id));
end;
$$;
revoke all on function public.dashboard_bundle(timestamptz, timestamptz, uuid, uuid, boolean) from public, anon;
grant execute on function public.dashboard_bundle(timestamptz, timestamptz, uuid, uuid, boolean) to authenticated;
$mig0115$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0116_private_sign_name.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0116', $mig0116$
-- =====================================================================
-- Assinatura no privado.
--
--  * Como nos grupos, a mensagem enviada pelo painel numa conversa
--    privada sai no WhatsApp com o nome de quem enviou em negrito na
--    primeira linha (ex.: *Ana Souza:*). No painel ela aparece sem a
--    assinatura, com o nome de quem enviou.
--  * Vale para texto e legenda de arquivo; mensagem encaminhada e áudio
--    não levam assinatura. Editar uma mensagem assinada mantém a
--    assinatura.
--  * Liga/desliga em Configurações › Atendimento › Responder pelo
--    sistema (começa ligado).
-- =====================================================================

alter table public.app_settings add column if not exists private_sign_name boolean not null default true;
-- o texto que sai no WhatsApp (com a assinatura); body continua sem, para o painel
alter table public.private_outgoing add column if not exists text_to_send text;
alter table public.private_actions add column if not exists text_to_send text;

create or replace function public.private_sign_text(p_company uuid, p_user uuid, p_body text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when p_user is null or nullif(btrim(coalesce(p_body, '')), '') is null then null
    when not coalesce((select private_sign_name from public.app_settings where company_id = p_company), true) then null
    else '*' || public.user_display_name(p_user) || ':*' || E'\n' || p_body
  end
$$;
revoke all on function public.private_sign_text(uuid, uuid, text) from public, anon, authenticated;

create or replace function public.private_outgoing_sign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(new.forwarded, false) and coalesce(new.message_type, 'text') <> 'audio' then
    new.text_to_send := public.private_sign_text(new.company_id, new.created_by, new.body);
  end if;
  return new;
end;
$$;
drop trigger if exists private_outgoing_sign on public.private_outgoing;
create trigger private_outgoing_sign before insert on public.private_outgoing
  for each row execute function public.private_outgoing_sign();

-- editar uma mensagem que saiu assinada: o texto novo sai com a mesma assinatura
create or replace function public.private_actions_sign()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o public.private_outgoing%rowtype;
begin
  if new.action <> 'edit' then
    return new;
  end if;
  select q.* into o
    from public.private_messages m
    join public.private_outgoing q on q.chat_id = m.chat_id and q.wa_message_id = m.wa_message_id
   where m.id = new.message_id and q.text_to_send is not null
   limit 1;
  if o.id is not null then
    new.text_to_send := '*' || public.user_display_name(o.created_by) || ':*' || E'\n' || new.new_body;
  end if;
  return new;
end;
$$;
drop trigger if exists private_actions_sign on public.private_actions;
create trigger private_actions_sign before insert on public.private_actions
  for each row execute function public.private_actions_sign();
$mig0116$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0117_masked_contact_names.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0117', $mig0117$
-- =====================================================================
-- Nome dos contatos: número mascarado não é nome.
--
--  * Para alguns contatos (os que o WhatsApp identifica só pelo
--    identificador interno, o LID), ele manda como "nome salvo" o número
--    mascarado (ex.: +55∙∙∙∙∙∙∙11). Isso era guardado como o nome e
--    aparecia no lugar do nome da pessoa.
--  * Agora "nome" que é só número (mascarado ou não) é descartado: vale o
--    nome salvo na agenda quando o WhatsApp manda, senão o nome que a
--    pessoa usa no WhatsApp.
--  * Os nomes mascarados já gravados são apagados e as conversas
--    privadas recebem de novo o nome certo.
-- =====================================================================

-- o nome, ou null se for só número / número mascarado
create or replace function public.contact_real_name(p_name text)
returns text language sql immutable as $$
  select case
    when nullif(btrim(coalesce(p_name, '')), '') is null then null
    -- sem nenhuma letra e com cara de telefone (começa com + ou dígito e tem pelo menos 4 dígitos),
    -- mascarado com qualquer símbolo
    when p_name !~ '[[:alpha:]]' and btrim(p_name) ~ '^\+?[0-9]'
         and length(regexp_replace(p_name, '\D', '', 'g')) >= 4 then null
    else btrim(p_name)
  end
$$;

create or replace function public.wa_contacts_clean_names()
returns trigger language plpgsql as $$
begin
  new.name := public.contact_real_name(new.name);
  new.notify := public.contact_real_name(new.notify);
  return new;
end;
$$;
drop trigger if exists wa_contacts_clean_names on public.wa_contacts;
create trigger wa_contacts_clean_names before insert or update of name, notify on public.wa_contacts
  for each row execute function public.wa_contacts_clean_names();

-- limpa o que já foi gravado
update public.wa_contacts set name = null
 where name is not null and public.contact_real_name(name) is null;
update public.wa_contacts set notify = null
 where notify is not null and public.contact_real_name(notify) is null;
-- conversas com o número mascarado no lugar do nome: o nome certo volta pela agenda (abaixo) ou pela
-- próxima mensagem
update public.private_chats set name = null
 where name is not null and public.contact_real_name(name) is null and btrim(name) !~ '^[-+0-9 ()]+$';

do $$
declare
  v_id uuid;
begin
  for v_id in select id from public.whatsapp_instances loop
    perform public.link_wa_contacts(v_id);
  end loop;
end $$;
$mig0117$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0118_private_mark_unread.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0118', $mig0118$
-- =====================================================================
-- Conversa privada: marcar como não lida.
--
--  * "Marcar como não lida" no topo da conversa: ela volta a contar como
--    não lida (o número na lista e no menu) até alguém abri-la de novo.
--  * Só na conversa que a pessoa vê (as suas, as sem responsável e, para
--    administradores, todas).
-- =====================================================================

create or replace function public.mark_private_chat_unread(p_chat_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.private_chat_visible(p_chat_id) then
    raise exception 'Conversa não encontrada.';
  end if;
  update public.private_chats set unread_count = greatest(unread_count, 1) where id = p_chat_id;
end;
$$;
revoke all on function public.mark_private_chat_unread(uuid) from public, anon;
grant execute on function public.mark_private_chat_unread(uuid) to authenticated;
$mig0118$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0119_private_chat_finish.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0119', $mig0119$
-- =====================================================================
-- Atendimento no privado: aguardando, meus atendimentos e finalizados.
--
--  * Finalizar atendimento: a conversa vai para "Finalizados" (fica com
--    quem atendeu). Se o cliente escrever de novo, ela volta para
--    "Aguardando" (sem responsável) e todos são avisados; se alguém da
--    equipe mandar mensagem por ela, reabre com essa pessoa.
--  * Transferir: para outro administrador ou atendente da empresa, com
--    uma observação opcional que vai no aviso de quem recebe. Transferir
--    uma conversa finalizada reabre o atendimento com quem recebeu.
-- =====================================================================

alter table public.private_chats
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null;
create index if not exists private_chats_closed_idx on public.private_chats (company_id, closed_at);

-- ------------------------------------------------ finalizar e reabrir
create or replace function public.finish_private_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  select * into c from public.private_chats where id = p_chat;
  if c.closed_at is not null then
    return;
  end if;
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador finaliza este atendimento.' using errcode = '42501';
  end if;
  update public.private_chats
     set closed_at = now(), closed_by = v_me, unread_count = 0,
         assigned_to = coalesce(assigned_to, v_me), assigned_at = coalesce(assigned_at, now())
   where id = p_chat;
end;
$$;
revoke all on function public.finish_private_chat(uuid) from public, anon;
grant execute on function public.finish_private_chat(uuid) to authenticated;

create or replace function public.reopen_private_chat(p_chat uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  update public.private_chats
     set closed_at = null, closed_by = null, assigned_to = auth.uid(), assigned_at = now()
   where id = p_chat and closed_at is not null;
end;
$$;
revoke all on function public.reopen_private_chat(uuid) from public, anon;
grant execute on function public.reopen_private_chat(uuid) to authenticated;

-- cliente escreveu numa conversa finalizada: volta para "Aguardando" (antes do aviso, que então vai
-- para todos). Mensagens antigas da sincronização não reabrem.
create or replace function public.private_messages_reopen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not new.from_me then
    update public.private_chats
       set closed_at = null, closed_by = null, assigned_to = null, assigned_at = null
     where id = new.chat_id and closed_at is not null and new.sent_at > closed_at;
  end if;
  return new;
end;
$$;
drop trigger if exists private_messages_reopen on public.private_messages;
create trigger private_messages_reopen before insert on public.private_messages
  for each row execute function public.private_messages_reopen();

-- envio pelo painel: na conversa sem responsável assume; na finalizada, reabre com quem enviou
create or replace function public.private_outgoing_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
begin
  if auth.uid() is null then
    return new;                                   -- worker / sistema
  end if;
  if not public.private_chat_visible(new.chat_id) then
    select assigned_to into v_owner from public.private_chats where id = new.chat_id;
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(v_owner)
      using errcode = '42501';
  end if;
  update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and assigned_to is null;
  update public.private_chats set closed_at = null, closed_by = null, assigned_to = auth.uid(), assigned_at = now()
   where id = new.chat_id and closed_at is not null;
  return new;
end;
$$;

-- ------------------------------------------------ transferir (com observação opcional)
drop function if exists public.assign_private_chat(uuid, uuid);
create or replace function public.assign_private_chat(p_chat uuid, p_user uuid, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_me uuid := auth.uid();
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.private_chat_visible(p_chat) then
    raise exception 'Conversa não encontrada.';
  end if;
  select * into c from public.private_chats where id = p_chat;
  -- sem responsável: qualquer um assume (ou passa para alguém); com responsável: ele ou um administrador
  if c.assigned_to is not null and c.assigned_to <> v_me and not public.private_sees_all() then
    raise exception 'Só o responsável ou um administrador muda o responsável desta conversa.' using errcode = '42501';
  end if;
  if p_user is not null and not exists (
       select 1 from public.profiles p
        where p.id = p_user and p.company_id = c.company_id and p.active
          and (p.platform_admin or p.role in ('admin', 'agent'))) then
    raise exception 'Escolha um administrador ou atendente ativo da empresa.';
  end if;
  if p_user is not distinct from c.assigned_to and c.closed_at is null then
    return;
  end if;
  -- transferir uma conversa finalizada reabre o atendimento com quem recebeu
  update public.private_chats
     set assigned_to = p_user, assigned_at = case when p_user is null then null else now() end,
         closed_at = null, closed_by = null
   where id = p_chat;
  -- quem recebeu a conversa de outra pessoa é avisado
  if p_user is not null and p_user <> v_me then
    perform public.queue_push(
      c.company_id, 'private', 'users',
      '💬 Conversa transferida para você',
      coalesce(nullif(btrim(c.name), ''), c.phone, 'Conversa privada') || ' · por ' || public.user_display_name(v_me)
        || coalesce(E'\n' || left(v_note, 160), ''),
      '/private?c=' || c.id, null, array[p_user], 'private:' || c.id, null);
  end if;
end;
$$;
revoke all on function public.assign_private_chat(uuid, uuid, text) from public, anon;
grant execute on function public.assign_private_chat(uuid, uuid, text) to authenticated;

-- quem pode receber uma conversa (para o "Transferir"), com o e-mail para diferenciar nomes repetidos
create or replace function public.private_chat_agents()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', public.user_display_name(p.id), 'email', p.email)
                            order by lower(public.user_display_name(p.id))), '[]'::jsonb)
    from public.profiles p
   where public.can_use_private_chats() and p.company_id = public.current_company_id() and p.active
     and (p.platform_admin or p.role in ('admin', 'agent'))
$$;
grant execute on function public.private_chat_agents() to authenticated;
$mig0119$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0120_private_alert_settings.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0120', $mig0120$
-- =====================================================================
-- Avisos das conversas privadas com configuração própria.
--
--  * Configurações › Monitoramento › Avisos em tela e voz › Conversas
--    privadas (administradores):
--    - aviso das conversas que o usuário está atendendo;
--    - aviso das conversas aguardando atendimento (antes seguia o aviso
--      de mensagem nova dos grupos);
--    - som e voz próprios do privado.
--  * Tudo começa ligado. A notificação no celular continua em Meu perfil
--    (cada usuário).
-- =====================================================================

alter table public.app_settings
  add column if not exists private_alert_mine boolean not null default true,
  add column if not exists private_alert_queue boolean not null default true,
  add column if not exists private_alert_sound boolean not null default true,
  add column if not exists private_alert_voice boolean not null default true;
$mig0120$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0121_instance_sector.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0121', $mig0121$
-- =====================================================================
-- Setor do número de WhatsApp conectado.
--
--  * Cada número conectado pode ter um setor (Configurações › WhatsApp).
--  * Conversas privadas que chegam por um número com setor: as que
--    aguardam atendimento só aparecem (e só avisam) para quem é do setor;
--    quem não é do setor só vê a conversa se ela for transferida para ele.
--    Administradores veem todas. Número sem setor: como antes (todos).
--  * Na tela de conversas privadas, filtro por setor.
--  * Iniciar conversa: usa o número do setor do usuário.
-- =====================================================================

alter table public.whatsapp_instances
  add column if not exists sector_id uuid references public.sectors(id) on delete set null;

-- o usuário pode atender as conversas que aguardam neste número? (sem setor: todos; com setor: quem é do setor)
create or replace function public.private_instance_ok(p_instance uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select i.sector_id is null
        or exists (select 1 from public.sector_members m where m.sector_id = i.sector_id and m.user_id = auth.uid())
      from public.whatsapp_instances i where i.id = p_instance), true)
$$;
revoke all on function public.private_instance_ok(uuid) from public, anon;
grant execute on function public.private_instance_ok(uuid) to authenticated;

create or replace function public.private_chat_visible(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and exists (
    select 1 from public.private_chats c
     where c.id = p_chat and c.company_id = public.current_company_id()
       and (c.assigned_to = auth.uid() or public.private_sees_all()
            or (c.assigned_to is null and public.private_instance_ok(c.instance_id))))
$$;

drop policy if exists private_chats_read on public.private_chats;
create policy private_chats_read on public.private_chats for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and (assigned_to = (select auth.uid()) or (select public.private_sees_all())
              or (assigned_to is null and public.private_instance_ok(instance_id))));

-- setor de um número (administradores)
create or replace function public.set_instance_sector(p_instance uuid, p_sector uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Só administradores mudam o setor do número.' using errcode = '42501';
  end if;
  if p_sector is not null and not exists (select 1 from public.sectors where id = p_sector and company_id = public.current_company_id()) then
    raise exception 'Setor não encontrado.';
  end if;
  update public.whatsapp_instances set sector_id = p_sector where id = p_instance and company_id = public.current_company_id();
  if not found then
    raise exception 'Conexão não encontrada.';
  end if;
end;
$$;
revoke all on function public.set_instance_sector(uuid, uuid) from public, anon;
grant execute on function public.set_instance_sector(uuid, uuid) to authenticated;

-- iniciar conversa: pelo número do setor do usuário
create or replace function public.start_private_chat(p_jid text default null, p_phone text default null, p_name text default null)
returns public.private_chats language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_instance uuid;
  v_phone text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_jid text := nullif(btrim(coalesce(p_jid, '')), '');
  v_contact public.wa_contacts%rowtype;
  v_row public.private_chats;
begin
  if not public.can_use_private_chats() then
    raise exception 'As conversas privadas não estão liberadas para você nesta empresa.' using errcode = '42501';
  end if;
  -- o número do setor do usuário (0121), mesmo desconectado (a mensagem sai quando ele voltar, e não
  -- por outro número); depois um sem setor; conectado antes de desconectado
  select i.id into v_instance from public.whatsapp_instances i
   where i.company_id = v_company
   order by (i.sector_id is not null and exists (select 1 from public.sector_members m
                                                  where m.sector_id = i.sector_id and m.user_id = auth.uid())) desc,
            (i.sector_id is null) desc, (i.status = 'connected') desc, i.created_at
   limit 1;
  if v_instance is null then
    raise exception 'Conecte um WhatsApp em Configurações › WhatsApp.';
  end if;
  if v_jid is null then
    if length(v_phone) between 10 and 11 then
      v_phone := '55' || v_phone;              -- DDD + número: Brasil
    end if;
    if length(v_phone) < 12 or length(v_phone) > 15 then
      raise exception 'Informe o número com DDD (e o código do país, se não for do Brasil).';
    end if;
    v_jid := v_phone || '@s.whatsapp.net';
    -- número digitado: o nome salvo na agenda (com ou sem o 9 do celular)
    select * into v_contact from public.wa_contacts
     where instance_id = v_instance and public.phone_key(phone) = public.phone_key(v_phone)
     order by (name is not null) desc limit 1;
  else
    select * into v_contact from public.wa_contacts where instance_id = v_instance and jid = v_jid;
    if v_contact.name is null and v_contact.phone is not null then
      select coalesce(v_contact.name, w.name) into v_contact.name from public.wa_contacts w
       where w.instance_id = v_instance and w.name is not null and public.phone_key(w.phone) = public.phone_key(v_contact.phone)
       limit 1;
    end if;
    v_phone := coalesce(v_contact.phone, nullif(split_part(v_jid, '@', 1), ''));
    if v_jid like '%@lid' and v_contact.phone is null then
      v_phone := null;
    end if;
  end if;

  insert into public.private_chats (instance_id, company_id, jid, phone, name)
  values (v_instance, v_company, v_jid, v_phone,
          coalesce(nullif(btrim(p_name), ''), v_contact.name, v_contact.notify))
  on conflict (instance_id, jid) do update
    set name = coalesce(public.private_chats.name, excluded.name),
        phone = coalesce(public.private_chats.phone, excluded.phone)
  returning * into v_row;
  -- quem inicia a conversa fica com ela; a de outro usuário só o administrador abre
  if v_row.assigned_to is null then
    update public.private_chats set assigned_to = auth.uid(), assigned_at = now()
     where id = v_row.id returning * into v_row;
  elsif v_row.assigned_to <> auth.uid() and not public.private_sees_all() then
    raise exception 'Esta conversa está com %. Peça para transferir para você.', public.user_display_name(v_row.assigned_to);
  end if;
  return v_row;
end;
$$
;
revoke all on function public.start_private_chat(text, text, text) from public, anon;
grant execute on function public.start_private_chat(text, text, text) to authenticated;

-- aviso no celular da conversa que aguarda num número com setor: só para o setor
create or replace function public.private_messages_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_sector uuid;
  v_title text;
  v_body text;
begin
  if new.from_me or new.sent_at < now() - interval '10 minutes' then
    return new;
  end if;
  select * into c from public.private_chats where id = new.chat_id;
  if not coalesce((select private_chats_enabled from public.companies where id = new.company_id), false) then
    return new;
  end if;
  v_title := '💬 ' || coalesce(nullif(btrim(c.name), ''), nullif(btrim(new.sender_name), ''), c.phone, 'Conversa privada');
  v_body := case new.message_type when 'text' then left(coalesce(new.body, ''), 160)
                                  when 'audio' then '🎤 Áudio' when 'image' then '📷 Imagem'
                                  when 'document' then '📄 Documento' when 'video' then '🎬 Vídeo'
                                  else coalesce(left(new.body, 160), 'Nova mensagem') end;
  select sector_id into v_sector from public.whatsapp_instances where id = c.instance_id;
  if c.assigned_to is null and v_sector is not null then
    -- número com setor (0121): só quem é do setor e usa o privado
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null,
      array(select p.id from public.sector_members m join public.profiles p on p.id = m.user_id
             where m.sector_id = v_sector and p.active and (p.platform_admin or p.role in ('admin', 'agent'))),
      'private:' || new.chat_id);
  elsif c.assigned_to is null then
    perform public.queue_push(new.company_id, 'private', 'private', v_title, v_body,
      '/private?c=' || new.chat_id, null, '{}', 'private:' || new.chat_id);
  else
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null, array[c.assigned_to], 'private:' || new.chat_id);
  end if;
  return new;
end;
$$;
$mig0121$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0122_groups_follow_instance_sector.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0122', $mig0122$
-- =====================================================================
-- Grupos no setor do número de WhatsApp.
--
--  * Grupo novo entra no setor do número pelo qual chegou (0121); número
--    sem setor: o setor padrão da empresa, como antes.
--  * Ao escolher o setor de um número, os grupos dele que estão no setor
--    padrão (ou sem setor, ou no setor anterior do número) passam para o
--    setor escolhido. Grupo colocado à mão em outro setor fica onde está.
--  * Os números que já têm setor levam agora os seus grupos que estão no
--    setor padrão.
-- =====================================================================

create or replace function public.groups_default_sector()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sector_id is null then
    select coalesce(
             (select i.sector_id from public.whatsapp_instances i where i.id = new.instance_id),
             (select s.default_sector_id from public.app_settings s where s.company_id = new.company_id))
      into new.sector_id;
  end if;
  return new;
end;
$$;

drop function if exists public.set_instance_sector(uuid, uuid);
-- devolve quantos grupos foram para o setor
create or replace function public.set_instance_sector(p_instance uuid, p_sector uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_old uuid;
  v_default uuid;
  v_moved int := 0;
begin
  if not public.is_admin() then
    raise exception 'Só administradores mudam o setor do número.' using errcode = '42501';
  end if;
  if p_sector is not null and not exists (select 1 from public.sectors where id = p_sector and company_id = v_company) then
    raise exception 'Setor não encontrado.';
  end if;
  select sector_id into v_old from public.whatsapp_instances where id = p_instance and company_id = v_company;
  if not found then
    raise exception 'Conexão não encontrada.';
  end if;
  update public.whatsapp_instances set sector_id = p_sector where id = p_instance;
  if p_sector is not null then
    select default_sector_id into v_default from public.app_settings where company_id = v_company;
    perform set_config('app.system_notice', 'on', true);
    update public.groups g set sector_id = p_sector
     where g.instance_id = p_instance and g.company_id = v_company
       and (g.sector_id is null or g.sector_id = v_default or g.sector_id = v_old)
       and g.sector_id is distinct from p_sector;
    get diagnostics v_moved = row_count;
    perform set_config('app.system_notice', 'off', true);
  end if;
  return v_moved;
end;
$$;
revoke all on function public.set_instance_sector(uuid, uuid) from public, anon;
grant execute on function public.set_instance_sector(uuid, uuid) to authenticated;

-- números que já têm setor: os grupos deles que estão no setor padrão (ou sem setor) vão para o setor do número
do $$
begin
  perform set_config('app.system_notice', 'on', true);
  update public.groups g set sector_id = i.sector_id
    from public.whatsapp_instances i
    left join public.app_settings s on s.company_id = i.company_id
   where g.instance_id = i.id and i.sector_id is not null
     and (g.sector_id is null or g.sector_id = s.default_sector_id)
     and g.sector_id is distinct from i.sector_id;
  perform set_config('app.system_notice', 'off', true);
end $$;
$mig0122$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0123_first_access_password.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0123', $mig0123$
-- 0123: troca de senha no primeiro acesso.
-- Quem entra com a senha inicial (cadastrada pelo administrador) ou com uma senha gerada por ele é
-- levado a definir a própria senha antes de usar o sistema. Usuários que já existiam não são afetados.

alter table public.profiles add column if not exists must_change_password boolean not null default false;

-- o próprio usuário limpa a marca depois de trocar a senha
create or replace function public.password_changed()
returns void language sql security definer set search_path = public as $$
  update public.profiles set must_change_password = false where id = auth.uid() and must_change_password;
$$;
revoke all on function public.password_changed() from public, anon;
grant execute on function public.password_changed() to authenticated;
$mig0123$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0124_private_queue_for_all.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0124', $mig0124$
-- =====================================================================
-- Conversas privadas aguardando atendimento: para todos os usuários.
--
--  * A conversa que aguarda (sem responsável) aparece e avisa para todos
--    que usam o privado, qualquer que seja o setor do número (0121).
--  * Depois que alguém assume, continua só com o responsável (e os
--    administradores), como antes.
--  * O setor do número segue valendo para o filtro da tela, para o número
--    usado ao iniciar conversa e para os grupos.
-- =====================================================================

-- usada nas regras de acesso (0121): a que aguarda é de todos
create or replace function public.private_instance_ok(p_instance uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select true
$$;
revoke all on function public.private_instance_ok(uuid) from public, anon;
grant execute on function public.private_instance_ok(uuid) to authenticated;

-- aviso no celular: a que aguarda vai para todos do privado; a assumida, para o responsável
create or replace function public.private_messages_push()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c public.private_chats%rowtype;
  v_title text;
  v_body text;
begin
  if new.from_me or new.sent_at < now() - interval '10 minutes' then
    return new;
  end if;
  select * into c from public.private_chats where id = new.chat_id;
  if not coalesce((select private_chats_enabled from public.companies where id = new.company_id), false) then
    return new;
  end if;
  v_title := '💬 ' || coalesce(nullif(btrim(c.name), ''), nullif(btrim(new.sender_name), ''), c.phone, 'Conversa privada');
  v_body := case new.message_type when 'text' then left(coalesce(new.body, ''), 160)
                                  when 'audio' then '🎤 Áudio' when 'image' then '📷 Imagem'
                                  when 'document' then '📄 Documento' when 'video' then '🎬 Vídeo'
                                  else coalesce(left(new.body, 160), 'Nova mensagem') end;
  if c.assigned_to is null then
    perform public.queue_push(new.company_id, 'private', 'private', v_title, v_body,
      '/private?c=' || new.chat_id, null, '{}', 'private:' || new.chat_id);
  else
    perform public.queue_push(new.company_id, 'private', 'users', v_title, v_body,
      '/private?c=' || new.chat_id, null, array[c.assigned_to], 'private:' || new.chat_id);
  end if;
  return new;
end;
$$;
$mig0124$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0125_private_phone_signature_owner.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0125', $mig0125$
-- =====================================================================
-- Conversa privada respondida direto pelo WhatsApp (celular / WhatsApp
-- Web) com a assinatura "*Nome:*" no começo: fica com o usuário do
-- sistema que tem esse nome, como se tivesse respondido pelo painel.
--
--  * Só a conversa sem responsável (aguardando) ou a finalizada (reabre).
--  * O nome é o do usuário no sistema (nome completo; ou só o primeiro
--    nome, se for de um usuário só). Nome que não bate, ou que bate com
--    mais de um usuário: a conversa continua como está.
--  * Mensagem sem assinatura: não há como saber quem enviou.
-- =====================================================================

-- o usuário da empresa que assina com este nome (null se nenhum ou mais de um)
create or replace function public.private_signer(p_company uuid, p_body text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := lower(btrim((regexp_match(coalesce(p_body, ''), '^\s*\*([^*\n]{2,80}):\*'))[1]));
  v_ids uuid[];
begin
  if v_name is null or v_name = '' then
    return null;
  end if;
  select array_agg(p.id) into v_ids from public.profiles p
   where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
     and lower(btrim(public.user_display_name(p.id))) = v_name;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    -- só o primeiro nome ("*Lurian:*")
    select array_agg(p.id) into v_ids from public.profiles p
     where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
       and lower(split_part(btrim(public.user_display_name(p.id)), ' ', 1)) = v_name;
  end if;
  return case when array_length(v_ids, 1) = 1 then v_ids[1] end;
end;
$$;
revoke all on function public.private_signer(uuid, text) from public, anon, authenticated;

create or replace function public.private_messages_signer_owner()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_user uuid;
begin
  if not new.from_me or auth.uid() is not null then
    return new;                                   -- só o que o worker registra
  end if;
  if not exists (select 1 from public.private_chats c
                  where c.id = new.chat_id
                    and ((c.assigned_to is null and c.closed_at is null) or (c.closed_at is not null and new.sent_at > c.closed_at))) then
    return new;
  end if;
  v_user := public.private_signer(new.company_id, new.body);
  if v_user is null then
    return new;
  end if;
  update public.private_chats
     set assigned_to = v_user, assigned_at = now(), closed_at = null, closed_by = null
   where id = new.chat_id
     and ((assigned_to is null and closed_at is null) or (closed_at is not null and new.sent_at > closed_at));
  return new;
end;
$$;
drop trigger if exists private_messages_signer_owner on public.private_messages;
create trigger private_messages_signer_owner after insert on public.private_messages
  for each row execute function public.private_messages_signer_owner();

-- as que estão aguardando agora: a última mensagem da empresa, se assinada por um usuário
update public.private_chats c
   set assigned_to = s.user_id, assigned_at = now()
  from (select distinct on (m.chat_id) m.chat_id, public.private_signer(m.company_id, m.body) as user_id
          from public.private_messages m
          join public.private_chats pc on pc.id = m.chat_id and pc.assigned_to is null and pc.closed_at is null
         where m.from_me
         order by m.chat_id, m.sent_at desc) s
 where c.id = s.chat_id and s.user_id is not null and c.assigned_to is null and c.closed_at is null;
$mig0125$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0126_private_signer_accents.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0126', $mig0126$
-- =====================================================================
-- Assinatura "*Nome:*" (0125): o nome bate sem diferenciar acentos,
-- maiúsculas e espaços ("*Pâmela Coimbra:*" = usuário "Pamela  Coimbra").
-- As conversas que estão aguardando são conferidas de novo.
-- =====================================================================

create or replace function public.private_name_key(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(regexp_replace(translate(lower(btrim(coalesce(p, ''))),
           'áàâãäåéèêëíìîïóòôõöúùûüçñý', 'aaaaaaeeeeiiiiooooouuuucny'), '\s+', ' ', 'g'), '')
$$;

create or replace function public.private_signer(p_company uuid, p_body text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := public.private_name_key((regexp_match(coalesce(p_body, ''), '^\s*\*\s*([^*\n]{2,80}):\s*\*'))[1]);
  v_ids uuid[];
begin
  if v_name is null then
    return null;
  end if;
  select array_agg(p.id) into v_ids from public.profiles p
   where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
     and public.private_name_key(public.user_display_name(p.id)) = v_name;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    -- só o primeiro nome ("*Pâmela:*")
    select array_agg(p.id) into v_ids from public.profiles p
     where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
       and split_part(public.private_name_key(public.user_display_name(p.id)), ' ', 1) = v_name;
  end if;
  return case when array_length(v_ids, 1) = 1 then v_ids[1] end;
end;
$$;
revoke all on function public.private_signer(uuid, text) from public, anon, authenticated;

-- as que estão aguardando agora: a última mensagem da empresa, se assinada por um usuário
update public.private_chats c
   set assigned_to = s.user_id, assigned_at = now()
  from (select distinct on (m.chat_id) m.chat_id, public.private_signer(m.company_id, m.body) as user_id
          from public.private_messages m
          join public.private_chats pc on pc.id = m.chat_id and pc.assigned_to is null and pc.closed_at is null
         where m.from_me
         order by m.chat_id, m.sent_at desc) s
 where c.id = s.chat_id and s.user_id is not null and c.assigned_to is null and c.closed_at is null;
$mig0126$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0127_private_signer_tolerant.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0127', $mig0127$
-- =====================================================================
-- Assinatura "*Nome:*" (0125/0126) mais tolerante ao jeito de escrever:
--   *Plinio Silva:*   *Plinio Silva*:   Plinio Silva:   * Plinio Silva :*
-- e com caracteres invisíveis no começo (alguns aparelhos e extensões do
-- WhatsApp Web colocam marcas de direção do texto antes da mensagem).
-- O nome continua tendo que ser o de um usuário do sistema; "Obs:" e
-- parecidos não batem com ninguém e não mudam nada.
-- =====================================================================

create or replace function public.private_signature(p_body text)
returns text language sql immutable set search_path = public as $$
  select public.private_name_key((regexp_match(coalesce(p_body, ''),
    '^[\s ​-‏‪-‮⁠﻿]*\*?\s*([^*\n:]{2,80})\*?\s*:\s*\*?'))[1])
$$;

create or replace function public.private_signer(p_company uuid, p_body text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := public.private_signature(p_body);
  v_ids uuid[];
begin
  if v_name is null then
    return null;
  end if;
  select array_agg(p.id) into v_ids from public.profiles p
   where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
     and public.private_name_key(public.user_display_name(p.id)) = v_name;
  if coalesce(array_length(v_ids, 1), 0) = 0 then
    -- só o primeiro nome ("*Plinio:*")
    select array_agg(p.id) into v_ids from public.profiles p
     where p.company_id = p_company and p.active and (p.platform_admin or p.role in ('admin', 'agent'))
       and split_part(public.private_name_key(public.user_display_name(p.id)), ' ', 1) = v_name;
  end if;
  return case when array_length(v_ids, 1) = 1 then v_ids[1] end;
end;
$$;
revoke all on function public.private_signer(uuid, text) from public, anon, authenticated;

-- as que estão aguardando agora: a última mensagem da empresa, se assinada por um usuário
update public.private_chats c
   set assigned_to = s.user_id, assigned_at = now()
  from (select distinct on (m.chat_id) m.chat_id, public.private_signer(m.company_id, m.body) as user_id
          from public.private_messages m
          join public.private_chats pc on pc.id = m.chat_id and pc.assigned_to is null and pc.closed_at is null
         where m.from_me
         order by m.chat_id, m.sent_at desc) s
 where c.id = s.chat_id and s.user_id is not null and c.assigned_to is null and c.closed_at is null;
$mig0127$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0128_private_signer_all_users.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0128', $mig0128$
-- =====================================================================
-- Assinatura "*Nome:*" (0125-0127) para todos os usuários, sem precisar
-- acertar cadastro:
--
--  * vale qualquer usuário ativo da empresa (qualquer perfil);
--  * o nome pode ser o do usuário ou o da pessoa na equipe (Pessoas);
--  * nome completo ou abreviado: "*Elen Regert:*" encontra "Elen Leticia
--    Pergher Regert", e "*Elen Leticia Pergher Regert:*" encontra "Elen
--    Regert" (mesmo primeiro nome e os outros nomes contidos no do outro);
--  * só o primeiro nome, se for de um usuário só.
-- Se mais de um usuário servir, a conversa continua aguardando.
-- =====================================================================

-- os nomes de cada usuário ativo da empresa (o do usuário e o da pessoa na equipe), em palavras
create or replace function public.private_signer_names(p_company uuid)
returns table (id uuid, words text[]) language sql stable security definer set search_path = public as $$
  select distinct x.id, string_to_array(x.k, ' ')
    from (select p.id, public.private_name_key(public.user_display_name(p.id)) as k
            from public.profiles p where p.company_id = p_company and p.active
          union
          select p.id, public.private_name_key(t.name)
            from public.team_members t
            join public.profiles p on p.company_id = t.company_id and p.active and lower(p.email) = lower(t.user_email)
           where t.company_id = p_company) x
   where x.k is not null
$$;
revoke all on function public.private_signer_names(uuid) from public, anon, authenticated;

create or replace function public.private_signer(p_company uuid, p_body text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_name text := public.private_signature(p_body);
  v_words text[];
  v_ids uuid[];
begin
  if v_name is null then
    return null;
  end if;
  v_words := string_to_array(v_name, ' ');

  -- 1) nome igual
  select array_agg(distinct id) into v_ids from public.private_signer_names(p_company) where words = v_words;
  -- 2) mesmo primeiro nome e um nome contido no outro (abreviado ou completo)
  if coalesce(array_length(v_ids, 1), 0) = 0 and array_length(v_words, 1) > 1 then
    select array_agg(distinct id) into v_ids from public.private_signer_names(p_company)
     where words[1] = v_words[1] and array_length(words, 1) > 1 and (words @> v_words or words <@ v_words);
  end if;
  -- 3) só o primeiro nome ("*Plinio:*")
  if coalesce(array_length(v_ids, 1), 0) = 0 and array_length(v_words, 1) = 1 then
    select array_agg(distinct id) into v_ids from public.private_signer_names(p_company) where words[1] = v_words[1];
  end if;
  return case when array_length(v_ids, 1) = 1 then v_ids[1] end;
end;
$$;
revoke all on function public.private_signer(uuid, text) from public, anon, authenticated;

-- as que estão aguardando agora: a última mensagem da empresa, se assinada por um usuário
update public.private_chats c
   set assigned_to = s.user_id, assigned_at = now()
  from (select distinct on (m.chat_id) m.chat_id, public.private_signer(m.company_id, m.body) as user_id
          from public.private_messages m
          join public.private_chats pc on pc.id = m.chat_id and pc.assigned_to is null and pc.closed_at is null
         where m.from_me
         order by m.chat_id, m.sent_at desc) s
 where c.id = s.chat_id and s.user_id is not null and c.assigned_to is null and c.closed_at is null;
$mig0128$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0129_general_sector_sees_all.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0129', $mig0129$
-- =====================================================================
-- Setor padrão ("Geral") vê tudo.
--
--  * Quem é do setor padrão da empresa (Configurações › Setores; sem setor
--    padrão definido, o setor chamado "Geral") vê os grupos de todos os
--    números conectados, com as permissões do setor padrão (demandas,
--    alertas), e todas as conversas privadas, inclusive as que estão com
--    outro usuário.
--  * Transferir/devolver a conversa de outro usuário continua sendo do
--    responsável ou de um administrador.
-- =====================================================================

-- o setor padrão da empresa
create or replace function public.general_sector_id(p_company uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a.default_sector_id from public.app_settings a
       join public.sectors s on s.id = a.default_sector_id
      where a.company_id = p_company),
    (select s.id from public.sectors s where s.company_id = p_company and lower(btrim(s.name)) = 'geral' order by s.created_at limit 1))
$$;
revoke all on function public.general_sector_id(uuid) from public, anon;
grant execute on function public.general_sector_id(uuid) to authenticated;

-- o usuário é do setor padrão?
create or replace function public.in_general_sector()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.sector_members m
                  where m.user_id = auth.uid() and m.sector_id = public.general_sector_id(public.current_company_id()))
$$;
revoke all on function public.in_general_sector() from public, anon;
grant execute on function public.in_general_sector() to authenticated;

-- ------------------------------------------------ grupos
create or replace function public.visible_group_ids()
returns uuid[] language sql stable security definer set search_path = public as $$
  select case
    when not public.is_active_user() then '{}'::uuid[]
    when exists (select 1 from public.profiles where id = auth.uid() and role = 'agenda' and not platform_admin) then '{}'::uuid[]
    when public.is_admin() or public.in_general_sector() then
      coalesce((select array_agg(g.id) from public.groups g where g.company_id = public.current_company_id()), '{}')
    else coalesce((
      select array_agg(distinct x.id) from (
        select g.id
        from public.groups g
        join public.sector_members sm on sm.sector_id = g.sector_id and sm.user_id = auth.uid()
        where g.company_id = public.current_company_id()
        union all
        select unnest(public.my_responsible_group_ids())
      ) x), '{}')
  end
$$;

create or replace function public.has_group_permission(p_group_id uuid, p_permission text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups where id = p_group_id and company_id = public.current_company_id())
     and public.is_active_user()
     and (p_permission = 'view' or public.can_write())
     and (public.is_admin()
          -- responsável pelo grupo: vê, responde, cuida das demandas e dos alertas
          or (p_permission in ('view', 'reply', 'demands', 'alerts') and p_group_id = any(public.my_responsible_group_ids()))
          or exists (
       select 1
       from public.groups g
       join public.sectors s on s.id = g.sector_id
                             or s.id = public.general_sector_id(g.company_id)   -- setor padrão: todos os grupos (0129)
       join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
       where g.id = p_group_id
         and case p_permission
               when 'view' then true
               when 'reply' then true  -- todos respondem nos grupos que veem (0094)
               when 'demands' then s.can_manage_demands
               when 'alerts' then s.can_handle_alerts
               else false
             end
     ))
$$;

create or replace function public.my_permissions()
returns jsonb language sql stable security definer set search_path = public as $$
  with grants as (
    -- cada grupo com as permissões dos meus setores (o setor padrão vale para todos os grupos, 0129)
    select g.id, s.can_reply, s.can_manage_demands, s.can_handle_alerts
      from public.groups g
      join public.sectors s on s.id = g.sector_id or s.id = public.general_sector_id(g.company_id)
      join public.sector_members sm on sm.sector_id = s.id and sm.user_id = auth.uid()
     where g.company_id = public.current_company_id()
  )
  select jsonb_build_object(
    'admin', public.is_admin(),
    'platform_admin', public.is_platform_admin(),
    'company_id', public.current_company_id(),
    'sectors', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'can_reply', s.can_reply,
                                          'can_manage_demands', s.can_manage_demands,
                                          'can_handle_alerts', s.can_handle_alerts) order by s.name)
      from public.sectors s join public.sector_members sm on sm.sector_id = s.id
      where sm.user_id = auth.uid() and s.company_id = public.current_company_id()), '[]'::jsonb),
    'reply_groups', coalesce((select jsonb_agg(distinct id) from grants where can_reply), '[]'::jsonb),
    'demand_groups', coalesce((select jsonb_agg(distinct id) from grants where can_manage_demands), '[]'::jsonb),
    'alert_groups', coalesce((select jsonb_agg(distinct id) from grants where can_handle_alerts), '[]'::jsonb)
  )
  where public.is_active_user()
$$;

-- ------------------------------------------------ conversas privadas
-- vê as conversas de todos: administradores e quem é do setor padrão
create or replace function public.private_sees_team()
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and (public.is_admin() or public.in_general_sector())
$$;
revoke all on function public.private_sees_team() from public, anon;
grant execute on function public.private_sees_team() to authenticated;

create or replace function public.private_chat_visible(p_chat uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_use_private_chats() and exists (
    select 1 from public.private_chats c
     where c.id = p_chat and c.company_id = public.current_company_id()
       and (c.assigned_to = auth.uid() or public.private_sees_team()
            or (c.assigned_to is null and public.private_instance_ok(c.instance_id))))
$$;

drop policy if exists private_chats_read on public.private_chats;
create policy private_chats_read on public.private_chats for select
  using ((select public.can_use_private_chats()) and company_id = (select public.current_company_id())
         and (assigned_to = (select auth.uid()) or (select public.private_sees_team())
              or (assigned_to is null and public.private_instance_ok(instance_id))));
$mig0129$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0130_private_dashboard.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0130', $mig0130$
-- =====================================================================
-- Dashboard das conversas privadas (filtro "Grupos | Privado").
--
-- private_dashboard(de, até, usuário, só números) devolve os indicadores
-- no mesmo formato do dashboard dos grupos (cartões, gráfico e tabela),
-- calculados com as permissões de quem pede: cada um vê os números das
-- conversas que vê (a fila e as suas; administradores e o setor padrão,
-- todas).
--
--  * Tempo de resposta: da primeira mensagem do cliente que ficou sem
--    resposta até a primeira resposta da empresa (tempo corrido).
--  * Quem respondeu: quem enviou pelo sistema; enviado pelo celular, o
--    responsável pela conversa.
--  * Filtro de usuário: as conversas que estão ou estiveram com ele e as
--    respostas dele.
-- =====================================================================

-- nome de um usuário da mesma empresa (para as listas e tabelas do dashboard)
create or replace function public.company_user_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.user_display_name(p_user)
   where exists (select 1 from public.profiles p where p.id = p_user and p.company_id = public.current_company_id())
$$;
revoke all on function public.company_user_name(uuid) from public, anon;
grant execute on function public.company_user_name(uuid) to authenticated;

create or replace function public.private_dashboard(
  p_from timestamptz, p_to timestamptz, p_user uuid default null, p_kpi_only boolean default false
)
returns jsonb language sql stable set search_path = public as $$
  with
  cfg as (
    select coalesce((select timezone from public.app_settings where company_id = public.current_company_id()), 'America/Sao_Paulo') as tz
  ),
  -- conversas que quem pede vê (RLS), com o filtro de usuário
  ch as materialized (
    select c.id, coalesce(nullif(btrim(c.name), ''), c.phone, 'Contato') as name, c.assigned_to, c.closed_at, c.closed_by,
           c.last_message_at
      from public.private_chats c
     where public.can_use_private_chats()
       and c.company_id = public.current_company_id()
       and (p_user is null or c.assigned_to = p_user or c.closed_by = p_user
            or exists (select 1 from public.private_outgoing o
                        where o.chat_id = c.id and o.created_by = p_user and o.created_at >= p_from and o.created_at < p_to))
  ),
  -- mensagens do período, com a anterior da mesma conversa
  msg as materialized (
    select m.id, m.chat_id, m.from_me, m.sent_at, m.wa_message_id,
           coalesce(lag(m.from_me) over (partition by m.chat_id order by m.sent_at),
                    (select p.from_me from public.private_messages p
                      where p.chat_id = m.chat_id and p.sent_at < p_from order by p.sent_at desc limit 1)) as prev_me
      from public.private_messages m
      join ch on ch.id = m.chat_id
     where m.sent_at >= p_from and m.sent_at < p_to
  ),
  -- quem enviou cada mensagem da empresa: pelo sistema, quem enviou; pelo celular, o responsável
  sent as materialized (
    select m.chat_id, m.sent_at,
           coalesce((select o.created_by from public.private_outgoing o
                      where o.chat_id = m.chat_id and o.wa_message_id = m.wa_message_id limit 1),
                    (select ch.assigned_to from ch where ch.id = m.chat_id)) as user_id
      from msg m
     where m.from_me
  ),
  -- mensagens do cliente no período que ficaram sem resposta até agora
  waits as materialized (
    select w.chat_id, w.sent_at
      from msg w
     where not w.from_me and coalesce(w.prev_me, true)
       and not exists (select 1 from public.private_messages x where x.chat_id = w.chat_id and x.from_me and x.sent_at >= w.sent_at)
  ),
  -- respostas do período (mensagem da empresa logo depois de mensagem do cliente): desde quando o cliente
  -- esperava (primeira mensagem dele depois da última resposta, mesmo antes do período) e quem respondeu
  answers as materialized (
    select r.chat_id, r.sent_at, s.user_id,
           extract(epoch from r.sent_at - (
             select min(x.sent_at) from public.private_messages x
              where x.chat_id = r.chat_id and not x.from_me and x.sent_at < r.sent_at
                and x.sent_at > coalesce((select max(y.sent_at) from public.private_messages y
                                           where y.chat_id = r.chat_id and y.from_me and y.sent_at < r.sent_at), '-infinity'))
           )::int as seconds
      from msg r
      join sent s on s.chat_id = r.chat_id and s.sent_at = r.sent_at
     where r.from_me and r.prev_me = false
       and (p_user is null or s.user_id = p_user)
  ),
  -- agora: sem resposta (última mensagem é do cliente) e na fila (sem responsável)
  pending as (
    select ch.id, ch.name, ch.assigned_to, l.sent_at as since
      from ch
      join lateral (select x.from_me, x.sent_at from public.private_messages x
                     where x.chat_id = ch.id order by x.sent_at desc limit 1) l on not l.from_me
     where ch.closed_at is null
  ),
  queue as (select ch.* from ch where ch.assigned_to is null and ch.closed_at is null and ch.last_message_at is not null),
  firsts as (
    select ch.id from ch
     where (select min(x.sent_at) from public.private_messages x where x.chat_id = ch.id) >= p_from
       and (select min(x.sent_at) from public.private_messages x where x.chat_id = ch.id) < p_to
  ),
  slots as (
    select s.t0, s.t1, s.x, s.hourly
      from cfg, public.ind_slots(jsonb_build_object('from', p_from, 'to', p_to, 'tz', cfg.tz)) s
  ),
  per_slot as (
    select s.t0, s.x, s.hourly,
           count(*) filter (where not m.from_me) as received,
           count(*) filter (where m.from_me) as sent,
           count(distinct m.chat_id) as chats
      from slots s
      cross join cfg
      left join msg m on m.sent_at at time zone cfg.tz >= s.t0 and m.sent_at at time zone cfg.tz < s.t1
     group by s.t0, s.x, s.hourly
  ),
  trend as (
    select jsonb_agg(jsonb_build_object('x', x, 'chats', chats, 'received', received, 'sent', sent) order by t0) as d,
           bool_or(hourly) as hourly
      from per_slot
  ),
  tot as (
    select (select count(distinct chat_id) from msg) as chats,
           (select count(*) from msg where not from_me) as received,
           (select count(*) from msg where from_me) as sent,
           (select round(avg(seconds)) from answers) as avg_reply,
           (select percentile_cont(0.5) within group (order by seconds) from answers) as median_reply,
           (select count(*) from answers) as answered,
           (select count(*) from waits) as unanswered,
           (select count(*) from ch where closed_at >= p_from and closed_at < p_to) as finished,
           (select count(*) from firsts) as new_contacts,
           (select count(*) from pending) as pending_now,
           (select count(*) from queue) as queue_now,
           (select count(*) from ch where assigned_to is not null and closed_at is null) as in_service
  ),
  kpi as (
    select jsonb_build_array(
      jsonb_build_object('key', 'priv_conversas', 'name', 'Conversas no período', 'block_key', 'priv_volume', 'block_name', 'Conversas privadas',
        'description', 'Conversas privadas com alguma mensagem no período', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.chats, 'format', 'number', 'unit', 'conversas',
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Novos contatos', 'value', tot.new_contacts, 'format', 'number')),
          'trend', jsonb_build_object('format', 'number', 'label', 'Conversas',
                     'data', (select jsonb_agg(jsonb_build_object('x', e->>'x', 'value', (e->>'chats')::int)) from trend, jsonb_array_elements(trend.d) e)))),
      jsonb_build_object('key', 'priv_recebidas', 'name', 'Mensagens recebidas', 'block_key', 'priv_volume', 'block_name', 'Conversas privadas',
        'description', 'Mensagens dos clientes no período', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.received, 'format', 'number',
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Enviadas pela empresa', 'value', tot.sent, 'format', 'number')),
          'trend', jsonb_build_object('format', 'number', 'label', 'Recebidas',
                     'data', (select jsonb_agg(jsonb_build_object('x', e->>'x', 'value', (e->>'received')::int)) from trend, jsonb_array_elements(trend.d) e)))),
      jsonb_build_object('key', 'priv_tempo_resposta', 'name', 'Tempo médio de resposta', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Da mensagem do cliente até a primeira resposta da empresa (tempo corrido)', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.avg_reply, 'format', 'duration',
          'tone', case when tot.avg_reply is null then null when tot.avg_reply <= 900 then 'good' when tot.avg_reply <= 3600 then 'warning' else 'critical' end,
          'secondary', jsonb_build_array(
            jsonb_build_object('label', 'Mediana', 'value', round(tot.median_reply::numeric), 'format', 'duration'),
            jsonb_build_object('label', 'Respondidas', 'value', tot.answered, 'format', 'number')))),
      jsonb_build_object('key', 'priv_sem_resposta', 'name', 'Sem resposta agora', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Conversas abertas em que a última mensagem é do cliente', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.pending_now, 'format', 'number', 'unit', 'conversas',
          'tone', case when tot.pending_now = 0 then 'good' when tot.pending_now <= 5 then 'warning' else 'critical' end,
          'list_size', 5, 'list_more', greatest(tot.pending_now - 20, 0),
          'list', coalesce((select jsonb_agg(jsonb_build_object('label', p.name,
                                     'sublabel', coalesce(public.company_user_name(p.assigned_to), 'Aguardando'),
                                     'detail', extract(epoch from now() - p.since)::int, 'detail_format', 'duration',
                                     'tone', case when now() - p.since > interval '1 hour' then 'critical' else null end) order by p.since)
                            from (select * from pending order by since limit 20) p), '[]'::jsonb))),
      jsonb_build_object('key', 'priv_fila', 'name', 'Aguardando atendimento', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Conversas sem responsável agora', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.queue_now, 'format', 'number', 'unit', 'na fila',
          'tone', case when tot.queue_now = 0 then 'good' else 'warning' end,
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Em atendimento', 'value', tot.in_service, 'format', 'number')))),
      jsonb_build_object('key', 'priv_finalizadas', 'name', 'Atendimentos finalizados', 'block_key', 'priv_atendimento', 'block_name', 'Atendimento',
        'description', 'Conversas finalizadas no período', 'size', 1, 'has_details', false,
        'data', jsonb_build_object('visual', 'kpi', 'value', tot.finished, 'format', 'number',
          'secondary', jsonb_build_array(jsonb_build_object('label', 'Clientes sem resposta no período', 'value', tot.unanswered, 'format', 'number'))))
    ) as items
    from tot
  ),
  charts as (
    select case when p_kpi_only then '[]'::jsonb else jsonb_build_array(
      jsonb_build_object('key', 'priv_volume_chart', 'name', 'Mensagens no período', 'block_key', 'priv_detalhes', 'block_name', 'Detalhes',
        'description', 'Mensagens recebidas dos clientes e enviadas pela empresa', 'size', 2, 'has_details', false,
        'data', jsonb_build_object('visual', case when trend.hourly then 'bars' else 'series' end, 'format', 'number',
          'series', jsonb_build_array(jsonb_build_object('key', 'received', 'label', 'Recebidas'),
                                      jsonb_build_object('key', 'sent', 'label', 'Enviadas')),
          'data', coalesce((select jsonb_agg(jsonb_build_object('x', e->>'x', 'label', e->>'x', 'received', (e->>'received')::int,
                                                                'sent', (e->>'sent')::int)) from jsonb_array_elements(trend.d) e), '[]'::jsonb))),
      jsonb_build_object('key', 'priv_atendentes', 'name', 'Atendimento por usuário', 'block_key', 'priv_detalhes', 'block_name', 'Detalhes',
        'description', 'Conversas, respostas e tempo de resposta de cada usuário no período', 'size', 3, 'has_details', false,
        'data', jsonb_build_object('visual', 'table',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'user', 'label', 'Usuário'),
            jsonb_build_object('key', 'chats', 'label', 'Conversas', 'format', 'number', 'align', 'right', 'bar', true),
            jsonb_build_object('key', 'sent', 'label', 'Mensagens enviadas', 'format', 'number', 'align', 'right'),
            jsonb_build_object('key', 'avg_reply', 'label', 'Tempo médio de resposta', 'format', 'duration', 'align', 'right'),
            jsonb_build_object('key', 'finished', 'label', 'Finalizadas', 'format', 'number', 'align', 'right'),
            jsonb_build_object('key', 'open_now', 'label', 'Em atendimento agora', 'format', 'number', 'align', 'right')),
          'rows', coalesce((
            select jsonb_agg(jsonb_build_object('user', public.company_user_name(u.user_id), 'chats', u.chats, 'sent', u.sent,
                                                'avg_reply', u.avg_reply, 'finished', u.finished, 'open_now', u.open_now)
                             order by u.chats desc, u.sent desc)
              from (
                select x.user_id,
                       (select count(distinct s.chat_id) from sent s where s.user_id = x.user_id) as chats,
                       (select count(*) from sent s where s.user_id = x.user_id) as sent,
                       (select round(avg(a.seconds)) from answers a where a.user_id = x.user_id) as avg_reply,
                       (select count(*) from ch where ch.closed_by = x.user_id and ch.closed_at >= p_from and ch.closed_at < p_to) as finished,
                       (select count(*) from ch where ch.assigned_to = x.user_id and ch.closed_at is null) as open_now
                  from (select user_id from sent union select assigned_to from ch where closed_at is null
                        union select closed_by from ch where closed_at >= p_from and closed_at < p_to) x
                 where x.user_id is not null and (p_user is null or x.user_id = p_user)
              ) u), '[]'::jsonb)))
    ) end as items
    from trend
  )
  select kpi.items || charts.items from kpi, charts
$$;
revoke all on function public.private_dashboard(timestamptz, timestamptz, uuid, boolean) from public, anon;
grant execute on function public.private_dashboard(timestamptz, timestamptz, uuid, boolean) to authenticated;
$mig0130$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0131_dashboard_speed_2.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0131', $mig0131$
-- =====================================================================
-- Dashboard e Painel de grupos mais rápidos (volume alto de mensagens).
--
-- Medido com ~50 mil mensagens de grupo (30 dias no dashboard):
--  * reply_signal (classifica cada mensagem do cliente: pergunta, pedido,
--    agradecimento...) levava ~0,4 ms por mensagem: 3,5 s só nas
--    conversas. Agora em plpgsql, normalizando o texto uma vez e só
--    testando as palavras (sem procurar qual delas bateu): ~14x mais
--    rápido, mesmo resultado.
--  * team_close_kind: o mesmo.
--  * ind_responses (respostas da equipe com o tempo em horário comercial)
--    era recalculada por cada indicador que a usa (e, dentro da consulta,
--    mais de uma vez): agora é calculada uma vez por carregamento e
--    reaproveitada, como as conversas (0115).
-- =====================================================================

create or replace function public.reply_signal(p_body text, p_type text, p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text;
  pat text;
begin
  if p_type in ('sticker', 'reaction') then
    return 'closing';
  end if;
  if p_type = 'audio' then
    return 'audio';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return case when p_type in ('image', 'video', 'document') then 'media' else 'plain' end;
  end if;
  n := public.norm_text(btrim(p_body));
  pat := public.kw_pattern(p->'urgent_keywords');
  if pat is not null and n ~ pat then
    return 'urgent';
  end if;
  if p_body ~ '[?¿]'
     or n ~ ('^(quem|qual|quais|quando|onde|como|quanto|quantos|quantas|por que|porque|pq|'
             || 'sera que|alguem|voces|vcs|tem como|teria como|consegue|conseguem|poderia|poderiam|pode(?! deixar)|podem|'
             || 'da pra|da para|e possivel|seria possivel|existe|ha como|tem previsao)([^[:alnum:]]|$)') then
    return 'question';
  end if;
  pat := public.kw_pattern(p->'request_keywords');
  if pat is not null and n ~ pat then
    return 'request';
  end if;
  if n ~ ('^(bom dia|boa tarde|boa noite|oi+|ola|opa|e ai|salve|oie)'
          || '([ ,!.]+(pessoal|a todos|todos|gente|galera|tudo bem|tudo bom|como vai))*[ !.,]*$') then
    return 'greeting';
  end if;
  pat := public.kw_pattern(p->'closing_keywords');
  if pat is not null and n ~ pat and length(btrim(p_body)) <= 80 then
    return 'closing';
  end if;
  -- só emojis/pontuação
  if p_body !~ '[[:alnum:]]' then
    return 'closing';
  end if;
  -- risadas
  if n ~ '^((k|ha|he|hi|rs|ks)+[ !.]*)+$' then
    return 'social';
  end if;
  return 'plain';
end;
$$;

create or replace function public.team_close_kind(p_body text, p jsonb)
returns text language plpgsql immutable set search_path = public as $$
declare
  n text;
  pat text;
begin
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    return null;
  end if;
  n := public.norm_text(p_body);
  pat := public.kw_pattern(p->'commitment_keywords');
  if pat is not null and n ~ pat then
    return 'compromisso';
  end if;
  pat := public.kw_pattern(p->'team_closing_keywords');
  if pat is not null and n ~ pat then
    return 'encerramento';
  end if;
  return null;
end;
$$;

-- ------------------------------------------------ respostas da equipe: uma vez por carregamento
-- o cálculo de antes, com outro nome
create or replace function public.ind_responses_calc(f jsonb)
returns table (
  id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
  response_time_seconds int, business_seconds int, sla_seconds int, client_name text, question text,
  asked_at timestamptz, asked_in_business boolean
)
language sql stable set search_path = public
as $$
  select r.id, r.group_id, r.group_name,
         coalesce(tm.name, r.sender_name, case when r.from_me then 'Número conectado' end, 'Equipe'),
         r.team_member_id, r.sent_at, r.response_time_seconds,
         public.business_seconds(r.sent_at - make_interval(secs => r.response_time_seconds), r.sent_at, f),
         r.sla_seconds,
         coalesce(q.sender_name, q.sender_phone, 'Cliente'), q.body,
         r.sent_at - make_interval(secs => r.response_time_seconds),
         public.is_business_time(r.sent_at - make_interval(secs => r.response_time_seconds), f)
  from public.ind_scope(f) r
  left join public.team_members tm on tm.id = r.team_member_id
  left join public.messages q on q.id = r.answered_message_id
  where r.from_team and r.response_time_seconds is not null
    and ((f->>'member_id') is null or r.team_member_id = (f->>'member_id')::uuid)
$$;

create or replace function public.ind_responses(f jsonb)
returns table (
  id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
  response_time_seconds int, business_seconds int, sla_seconds int, client_name text, question text,
  asked_at timestamptz, asked_in_business boolean
)
language plpgsql stable set search_path = public as $$
declare
  -- guardada só durante o carregamento (transação) de quem pediu
  v_key text := 'mgresp.k' || md5(f::text || '|' || coalesce(auth.uid()::text, ''));
  v text := current_setting(v_key, true);
begin
  if v is null or v = '' then
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb)::text into v from public.ind_responses_calc(f) c;
    perform set_config(v_key, v, true);
  end if;
  return query
    select * from jsonb_to_recordset(v::jsonb) as x(
      id uuid, group_id uuid, group_name text, responder text, team_member_id uuid, sent_at timestamptz,
      response_time_seconds int, business_seconds int, sla_seconds int, client_name text, question text,
      asked_at timestamptz, asked_in_business boolean);
end;
$$;

-- ------------------------------------------------ "SLA só no horário comercial": lido uma vez por carregamento
-- (nos indicadores ela entra no cálculo de cada resposta; lida a cada linha, eram ~0,5 ms por resposta)
create or replace function public.sla_business_time_only()
returns boolean language plpgsql stable set search_path = public as $$
declare
  v_key text := 'mgsla.u' || replace(coalesce(auth.uid()::text, 'x'), '-', '');
  v text := current_setting(v_key, true);
begin
  if v is null or v = '' then
    v := coalesce((select (params->>'business_time_only')::boolean from public.my_indicators where key = 'taxa_resposta_sla'), true)::text;
    perform set_config(v_key, v, true);
  end if;
  return v::boolean;
end;
$$;

-- ------------------------------------------------ conversas privadas
-- quem enviou cada mensagem (dashboard do privado, 0130) e as exclusões em cascata da conversa
create index if not exists private_outgoing_chat_wa_idx on public.private_outgoing (chat_id, wa_message_id);
create index if not exists private_actions_chat_idx on public.private_actions (chat_id);

-- ------------------------------------------------ demandas: "minhas pessoas da equipe" calculado uma vez por consulta
drop policy if exists demands_read on public.demands;
create policy demands_read on public.demands for select
  using (group_id in (select unnest(public.visible_group_ids()))
         or (company_id = (select public.current_company_id())
             and assignee_id in (select unnest(public.my_team_member_ids()))));
$mig0131$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0132_recalc_in_steps.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0132', $mig0132$
-- =====================================================================
-- "Recalcular grupos" em etapas curtas.
--
-- Com muitas mensagens, o recálculo inteiro numa operação só passava do
-- limite de 8 s do Supabase para quem está logado ("canceling statement
-- due to statement timeout"). Agora a tela faz em etapas, cada uma curta:
--   1) recalc_company_reclassify: quem é equipe e quem é cliente;
--   2) recalc_company_rebuild: a situação dos grupos, em lotes;
--   3) recalc_company_finish: alertas de "sem resposta" resolvidos.
-- recalc_company_groups_core (usado ao mudar a equipe) faz as três etapas,
-- com o mesmo resultado de antes.
-- =====================================================================

-- 1) mensagens: completa remetentes e separa equipe x cliente
create or replace function public.recalc_company_reclassify(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_reclass    int := 0;
  v_unmark     int := 0;
  v_n          int := 0;
  v_before     int;
  v_ids        uuid[] := '{}';   -- grupos com mensagens que mudaram de lado (cliente × equipe)
  v_part       uuid[];
begin
  if p_company_id is null then
    raise exception 'empresa não informada';
  end if;
  select count(*) into v_before from public.groups
   where company_id = p_company_id and pending_since is not null and removed_at is null;

  -- 0) mensagens que chegaram só com o LID (sem telefone): completa telefone e nome pela lista
  --    de membros (do próprio grupo ou de outro grupo da empresa) e pelos contatos do WhatsApp
  update public.messages m
     set sender_phone = gp.phone,
         sender_name = coalesce(m.sender_name, nullif(gp.name, ''))
    from public.groups g, public.group_participants gp
   where g.id = m.group_id and g.company_id = p_company_id
     and gp.group_id = m.group_id
     and m.sender_phone is null and not m.from_me
     and m.sender_jid is not null and gp.phone is not null
     and m.sender_jid in (gp.jid, gp.lid);
  update public.messages m
     set sender_phone = coalesce(
       (select gp.phone from public.group_participants gp join public.groups g2 on g2.id = gp.group_id
         where g2.company_id = p_company_id and gp.phone is not null and m.sender_jid in (gp.jid, gp.lid) limit 1),
       (select w.phone from public.wa_contacts w
         where w.company_id = p_company_id and w.phone is not null and (w.jid = m.sender_jid or w.lid = m.sender_jid) limit 1),
       public.lid_phone(g.instance_id, m.sender_jid))
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company_id
     and m.sender_phone is null and not m.from_me and m.sender_jid like '%@lid';

  -- mensagens sem remetente nenhum (o WhatsApp não informou): se o grupo só tem uma pessoa além
  -- do número conectado, a mensagem é dela (0081)
  update public.messages m
     set sender_jid = c.jid, sender_phone = c.phone, sender_name = coalesce(m.sender_name, nullif(c.name, ''))
    from public.groups g,
         lateral (
           select (array_agg(gp.jid))[1] as jid, (array_agg(gp.phone))[1] as phone, (array_agg(gp.name))[1] as name, count(*) as n
             from public.group_participants gp
             left join public.whatsapp_instances w on w.id = g.instance_id
            where gp.group_id = g.id and gp.left_at is null
              and (w.phone is null or gp.phone is null
                   or public.phone_key(gp.phone) is distinct from public.phone_key(regexp_replace(w.phone, '\D', '', 'g')))
         ) c
   where g.id = m.group_id and g.company_id = p_company_id
     and m.sender_jid is null and m.sender_phone is null and not m.from_me
     and c.n = 1 and c.jid is not null;

  -- mensagens do próprio número conectado (celular ou painel) são sempre da equipe
  with u as (
    update public.messages m set from_team = true
      from public.groups g
     where g.id = m.group_id and g.company_id = p_company_id and m.from_me and not m.from_team
    returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_reclass, v_part from u;
  v_ids := v_ids || v_part;

  -- 1) mensagens da equipe que estavam como de cliente
  with u as (
  update public.messages m
     set from_team = true, team_member_id = t.id, sender_name = coalesce(m.sender_name, t.name)
    from public.groups g, public.team_members t
   where g.id = m.group_id and g.company_id = p_company_id
     and t.company_id = p_company_id and t.active
     -- de cliente, ou da equipe sem o cadastro (pessoa apagada e cadastrada de novo)
     and (not m.from_team or (m.team_member_id is null and not m.from_me))
     and ((t.jid is not null and m.sender_jid = t.jid)
          -- equipe cadastrada pelo telefone, mensagem só com o LID desse telefone
          or (t.phone is not null and m.sender_jid like '%@lid' and exists (
                select 1 from public.group_participants gp
                where gp.group_id = m.group_id and gp.lid = m.sender_jid and gp.phone is not null
                  and public.phone_key(gp.phone) = public.phone_key(t.phone)))
          or (t.phone is not null and m.sender_phone is not null
              and public.phone_key(m.sender_phone) = public.phone_key(t.phone)))
  returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_n, v_part from u;
  v_reclass := v_reclass + v_n;
  v_ids := v_ids || v_part;

  -- 1b) mensagens como da equipe de quem não é (nem foi) da equipe: a pessoa saiu do
  --     cadastro (apagada, não só desativada) e não bate com ninguém da equipe
  with u as (
  update public.messages m
     set from_team = false
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company_id
     and m.from_team and not m.from_me and m.team_member_id is null
     and not exists (
       select 1 from public.team_members t
        where t.company_id = p_company_id
          and ((t.jid is not null and m.sender_jid = t.jid)
               or (t.phone is not null and m.sender_phone is not null
                   and public.phone_key(m.sender_phone) = public.phone_key(t.phone))))
  returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_unmark, v_part from u;
  v_ids := v_ids || v_part;

  return jsonb_build_object('reclass', v_reclass, 'unmark', v_unmark, 'before', v_before,
                            'changed_ids', to_jsonb(coalesce((select array_agg(distinct x) from unnest(v_ids) x), '{}')));
end;
$$;
revoke all on function public.recalc_company_reclassify(uuid) from public, anon, authenticated;
grant execute on function public.recalc_company_reclassify(uuid) to service_role;

-- 2) situação de alguns grupos (um lote)
create or replace function public.recalc_company_rebuild(p_company_id uuid, p_ids uuid[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_g      record;
  v_new    public.groups%rowtype;
  v_groups int := 0;
begin
  -- 2) situação de cada grupo
  for v_g in
    select id, pending_since, pending_message_id, pending_count
      from public.groups
     where company_id = p_company_id and id = any(p_ids)
  loop
    perform public.rebuild_group_state(v_g.id, coalesce(v_g.pending_since, now()));
    select * into v_new from public.groups where id = v_g.id;
    -- a pendência só diminui: o que estava resolvido (inclusive "marcar como
    -- respondida" e pendências antigas do histórico) não volta
    if v_g.pending_since is null and v_new.pending_since is not null then
      update public.groups set pending_since = null, pending_message_id = null, pending_count = 0 where id = v_g.id;
    elsif v_g.pending_since is not null and v_new.pending_since is not null and v_new.pending_since < v_g.pending_since then
      update public.groups
         set pending_since = v_g.pending_since, pending_message_id = v_g.pending_message_id, pending_count = v_g.pending_count
       where id = v_g.id;
    end if;
    v_groups := v_groups + 1;
  end loop;

  return v_groups;
end;
$$;
revoke all on function public.recalc_company_rebuild(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.recalc_company_rebuild(uuid, uuid[]) to service_role;

-- 3) alertas e o total de "aguardando" no fim
create or replace function public.recalc_company_finish(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_alerts int := 0;
  v_after  int;
begin
  -- 3) alertas de "sem resposta" de grupos que ficaram em dia
  update public.alerts a set status = 'resolved', resolved_at = now()
    from public.groups g
   where g.id = a.group_id and g.company_id = p_company_id and g.pending_since is null
     and a.type = 'no_response' and a.status <> 'resolved';
  get diagnostics v_alerts = row_count;

  select count(*) into v_after from public.groups
   where company_id = p_company_id and pending_since is not null and removed_at is null;
  return jsonb_build_object('after', v_after, 'alerts', v_alerts);
end;
$$;
revoke all on function public.recalc_company_finish(uuid) from public, anon, authenticated;
grant execute on function public.recalc_company_finish(uuid) to service_role;

-- as três etapas juntas (ao mudar a equipe; mesmo resultado de antes)
create or replace function public.recalc_company_groups_core(p_company_id uuid, p_only_changed boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_r   jsonb := public.recalc_company_reclassify(p_company_id);
  v_ids uuid[];
  v_n   int;
  v_f   jsonb;
begin
  v_ids := case when p_only_changed
                then array(select jsonb_array_elements_text(v_r->'changed_ids')::uuid)
                else array(select id from public.groups where company_id = p_company_id) end;
  v_n := public.recalc_company_rebuild(p_company_id, v_ids);
  v_f := public.recalc_company_finish(p_company_id);
  return jsonb_build_object(
    'mensagens_reclassificadas', (v_r->>'reclass')::int + (v_r->>'unmark')::int,
    'mensagens_da_equipe', (v_r->>'reclass')::int,
    'mensagens_de_cliente', (v_r->>'unmark')::int,
    'grupos_recalculados', v_n,
    'aguardando_antes', (v_r->>'before')::int,
    'aguardando_depois', (v_f->>'after')::int,
    'alertas_resolvidos', (v_f->>'alerts')::int
  );
end;
$$;
revoke all on function public.recalc_company_groups_core(uuid, boolean) from public, anon, authenticated;
grant execute on function public.recalc_company_groups_core(uuid, boolean) to service_role;
$mig0132$);
commit;

-- >>>>>>>>>>>>>>>>>>>> 0133_company_numbers_are_team.sql <<<<<<<<<<<<<<<<<<<<
select public._apply_migration('0133', $mig0133$
-- =====================================================================
-- Mensagens de outro número conectado da empresa contam como da empresa.
--
-- Cada número conectado tem a sua cópia do grupo. Num grupo com dois
-- números da empresa, o que um envia chega ao outro como de um membro
-- qualquer: o sistema só o reconhecia se o telefone estivesse em Pessoas
-- (e aí com o nome da pessoa), senão era cliente. Agora é sempre a
-- empresa, com o nome do número no WhatsApp (o worker faz o mesmo ao
-- receber). As mensagens já gravadas são corrigidas e os grupos
-- afetados, recalculados.
-- =====================================================================

create or replace function public.recalc_company_reclassify(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_reclass    int := 0;
  v_unmark     int := 0;
  v_n          int := 0;
  v_before     int;
  v_ids        uuid[] := '{}';   -- grupos com mensagens que mudaram de lado (cliente × equipe)
  v_part       uuid[];
begin
  if p_company_id is null then
    raise exception 'empresa não informada';
  end if;
  select count(*) into v_before from public.groups
   where company_id = p_company_id and pending_since is not null and removed_at is null;

  -- 0) mensagens que chegaram só com o LID (sem telefone): completa telefone e nome pela lista
  --    de membros (do próprio grupo ou de outro grupo da empresa) e pelos contatos do WhatsApp
  update public.messages m
     set sender_phone = gp.phone,
         sender_name = coalesce(m.sender_name, nullif(gp.name, ''))
    from public.groups g, public.group_participants gp
   where g.id = m.group_id and g.company_id = p_company_id
     and gp.group_id = m.group_id
     and m.sender_phone is null and not m.from_me
     and m.sender_jid is not null and gp.phone is not null
     and m.sender_jid in (gp.jid, gp.lid);
  update public.messages m
     set sender_phone = coalesce(
       (select gp.phone from public.group_participants gp join public.groups g2 on g2.id = gp.group_id
         where g2.company_id = p_company_id and gp.phone is not null and m.sender_jid in (gp.jid, gp.lid) limit 1),
       (select w.phone from public.wa_contacts w
         where w.company_id = p_company_id and w.phone is not null and (w.jid = m.sender_jid or w.lid = m.sender_jid) limit 1),
       public.lid_phone(g.instance_id, m.sender_jid))
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company_id
     and m.sender_phone is null and not m.from_me and m.sender_jid like '%@lid';

  -- mensagens sem remetente nenhum (o WhatsApp não informou): se o grupo só tem uma pessoa além
  -- do número conectado, a mensagem é dela (0081)
  update public.messages m
     set sender_jid = c.jid, sender_phone = c.phone, sender_name = coalesce(m.sender_name, nullif(c.name, ''))
    from public.groups g,
         lateral (
           select (array_agg(gp.jid))[1] as jid, (array_agg(gp.phone))[1] as phone, (array_agg(gp.name))[1] as name, count(*) as n
             from public.group_participants gp
             left join public.whatsapp_instances w on w.id = g.instance_id
            where gp.group_id = g.id and gp.left_at is null
              and (w.phone is null or gp.phone is null
                   or public.phone_key(gp.phone) is distinct from public.phone_key(regexp_replace(w.phone, '\D', '', 'g')))
         ) c
   where g.id = m.group_id and g.company_id = p_company_id
     and m.sender_jid is null and m.sender_phone is null and not m.from_me
     and c.n = 1 and c.jid is not null;

  -- mensagens do próprio número conectado (celular ou painel) são sempre da equipe
  with u as (
    update public.messages m set from_team = true
      from public.groups g
     where g.id = m.group_id and g.company_id = p_company_id and m.from_me and not m.from_team
    returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_reclass, v_part from u;
  v_ids := v_ids || v_part;

  -- 0b) mensagens de outro número conectado da empresa (dois números no mesmo grupo): é a empresa,
  --     com o nome do número no WhatsApp, mesmo que alguém em Pessoas tenha esse telefone (0133)
  with u as (
    update public.messages m
       set from_team = true, team_member_id = null,
           sender_name = coalesce(nullif(w.push_name, ''), nullif(w.name, ''), 'Número da empresa')
      from public.groups g, public.whatsapp_instances w
     where g.id = m.group_id and g.company_id = p_company_id
       and w.company_id = p_company_id and w.phone is not null
       and not m.from_me and m.sender_phone is not null
       and public.phone_key(m.sender_phone) = public.phone_key(w.phone)
       and (not m.from_team or m.team_member_id is not null
            or m.sender_name is distinct from coalesce(nullif(w.push_name, ''), nullif(w.name, ''), 'Número da empresa'))
    returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_n, v_part from u;
  v_reclass := v_reclass + v_n;
  v_ids := v_ids || v_part;

  -- 1) mensagens da equipe que estavam como de cliente
  with u as (
  update public.messages m
     set from_team = true, team_member_id = t.id, sender_name = coalesce(m.sender_name, t.name)
    from public.groups g, public.team_members t
   where g.id = m.group_id and g.company_id = p_company_id
     and t.company_id = p_company_id and t.active
     -- de cliente, ou da equipe sem o cadastro (pessoa apagada e cadastrada de novo)
     and (not m.from_team or (m.team_member_id is null and not m.from_me))
     and not exists (select 1 from public.whatsapp_instances w2
                      where w2.company_id = p_company_id and w2.phone is not null and m.sender_phone is not null
                        and public.phone_key(m.sender_phone) = public.phone_key(w2.phone))
     and ((t.jid is not null and m.sender_jid = t.jid)
          -- equipe cadastrada pelo telefone, mensagem só com o LID desse telefone
          or (t.phone is not null and m.sender_jid like '%@lid' and exists (
                select 1 from public.group_participants gp
                where gp.group_id = m.group_id and gp.lid = m.sender_jid and gp.phone is not null
                  and public.phone_key(gp.phone) = public.phone_key(t.phone)))
          or (t.phone is not null and m.sender_phone is not null
              and public.phone_key(m.sender_phone) = public.phone_key(t.phone)))
  returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_n, v_part from u;
  v_reclass := v_reclass + v_n;
  v_ids := v_ids || v_part;

  -- 1b) mensagens como da equipe de quem não é (nem foi) da equipe: a pessoa saiu do
  --     cadastro (apagada, não só desativada) e não bate com ninguém da equipe
  with u as (
  update public.messages m
     set from_team = false
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company_id
     and m.from_team and not m.from_me and m.team_member_id is null
     and not exists (select 1 from public.whatsapp_instances w2
                      where w2.company_id = p_company_id and w2.phone is not null and m.sender_phone is not null
                        and public.phone_key(m.sender_phone) = public.phone_key(w2.phone))
     and not exists (
       select 1 from public.team_members t
        where t.company_id = p_company_id
          and ((t.jid is not null and m.sender_jid = t.jid)
               or (t.phone is not null and m.sender_phone is not null
                   and public.phone_key(m.sender_phone) = public.phone_key(t.phone))))
  returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_unmark, v_part from u;
  v_ids := v_ids || v_part;

  return jsonb_build_object('reclass', v_reclass, 'unmark', v_unmark, 'before', v_before,
                            'changed_ids', to_jsonb(coalesce((select array_agg(distinct x) from unnest(v_ids) x), '{}')));
end;
$$;
revoke all on function public.recalc_company_reclassify(uuid) from public, anon, authenticated;
grant execute on function public.recalc_company_reclassify(uuid) to service_role;

-- já gravadas: corrige e recalcula só os grupos que mudaram
do $fix$
declare
  c uuid;
begin
  for c in select distinct company_id from public.whatsapp_instances where phone is not null loop
    perform public.recalc_company_groups_core(c, true);
  end loop;
end $fix$;
$mig0133$);
commit;

-- segurança (0095): reaplica a trava de acesso sem login, também nas funções criadas acima
do $lock$ begin if to_regprocedure('public.lock_down_public_access()') is not null then perform public.lock_down_public_access(); end if; end $lock$;
commit;

notify pgrst, 'reload schema';

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
      or exists (select 1 from pg_proc where proname = 'match_keyword' and prolang = (select oid from pg_language where lanname = 'plpgsql'))
      -- 0115 refez a busca (padrão das palavras guardado no carregamento)
      or to_regprocedure('public.kw_pattern(jsonb)') is not null),
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
  (117, 'Assinatura sem diferenciar acentos (0126)', to_regprocedure('public.private_name_key(text)') is not null),
  (118, 'Assinatura em qualquer formato (0127)', to_regprocedure('public.private_signature(text)') is not null),
  (119, 'Assinatura para todos os usuários (0128)', to_regprocedure('public.private_signer_names(uuid)') is not null),
  (120, 'Setor padrão vê tudo (0129)', to_regprocedure('public.private_sees_team()') is not null),
  (121, 'Dashboard do privado (0130)', to_regprocedure('public.private_dashboard(timestamptz,timestamptz,uuid,boolean)') is not null),
  (122, 'Dashboard mais rápido (0131)', to_regprocedure('public.ind_responses_calc(jsonb)') is not null),
  (123, 'Recalcular grupos em etapas (0132)', to_regprocedure('public.recalc_company_rebuild(uuid,uuid[])') is not null),
  (124, 'Outro número da empresa conta como empresa (0133)', coalesce(pg_get_functiondef('public.recalc_company_reclassify(uuid)'::regprocedure) like '%0133%', false)),
  (125, 'Indicadores no catálogo: ' || (select count(*) from public.indicators), (select count(*) from public.indicators) >= 24)
) as t(ord, item, ok)
order by ord;
