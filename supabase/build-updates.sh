#!/bin/sh
# Gera supabase/atualizar_banco.sql juntando os scripts 0002 em diante, na ordem.
# Uso: sh supabase/build-updates.sh
cd "$(dirname "$0")"
# itens da conferência: (ordem, rótulo com a versão entre parênteses, está aplicado?)
# usados no fim do arquivo e na primeira execução com o controle de versões
CHECKS=$(cat <<'SQL'
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
  (88, 'Agenda por usuário e setores da agenda (0097)', to_regclass('public.agenda_event_people') is not null and to_regclass('public.agenda_teams') is not null),
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
  (98, 'Indicadores no catálogo: ' || (select count(*) from public.indicators), (select count(*) from public.indicators) >= 24)
SQL
)
VERSIONS=$(ls migrations | grep -E '^0[0-9]{3}_' | grep -v '^0001_' | cut -c1-4 | paste -sd, -)
{
  echo "-- ====================================================================="
  echo "-- ATUALIZAÇÃO COMPLETA DO BANCO (gerado por supabase/build-updates.sh)"
  echo "-- Junta os scripts 0002 em diante, na ordem. Pode ser executado quantas"
  echo "-- vezes quiser."
  echo "-- Pré-requisito: 0001_schema.sql já executado (instalação inicial)."
  echo "--"
  echo "-- O banco guarda quais scripts já foram aplicados (schema_migrations):"
  echo "-- só os que faltam rodam, então quase nada é travado. Se mesmo assim o"
  echo "-- banco acusar \"deadlock detected\" (o worker e o painel usando as tabelas),"
  echo "-- a parte é repetida sozinha, até 5 vezes. Se ainda assim falhar, o que já"
  echo "-- foi aplicado fica e basta executar de novo."
  echo "-- ====================================================================="
  cat <<'SQL'

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
SQL
  printf '%s\n' "$CHECKS"
  cat <<SQL
      ) as t(ord, item, ok)
      where not coalesce(ok, false)
    \$q\$ into v_fail;
  exception when others then
    v_fail := null; -- banco antigo: aplica tudo (o que já existe é mantido)
  end;
  if v_fail is not null then
    insert into public.schema_migrations (version)
    select v from unnest(string_to_array('$VERSIONS', ',')) v where v < v_fail
    on conflict do nothing;
  end if;
end \$seed\$;
SQL
  for f in migrations/0*.sql; do
    case "$f" in migrations/0001_*) continue ;; esac
    v=$(basename "$f" | cut -c1-4)
    echo ""
    echo "-- >>>>>>>>>>>>>>>>>>>> $(basename "$f") <<<<<<<<<<<<<<<<<<<<"
    echo "select public._apply_migration('$v', \$mig$v\$"
    cat "$f"
    echo "\$mig$v\$);"
    # grava ao fim de cada script: as travas das tabelas duram só aquele trecho
    echo "commit;"
  done
  echo ""
  echo "-- segurança (0095): reaplica a trava de acesso sem login, também nas funções criadas acima"
  echo "do \$lock\$ begin if to_regprocedure('public.lock_down_public_access()') is not null then perform public.lock_down_public_access(); end if; end \$lock\$;"
  echo "commit;"
  echo ""
  echo "notify pgrst, 'reload schema';"
  cat <<'SQL'

-- ---------------------------------------------------------------------
-- Conferência: o SQL Editor mostra esta tabela no final.
-- Todas as linhas com "OK" = banco atualizado.
-- ---------------------------------------------------------------------
select item as "Item", case when ok then 'OK' else 'FALTANDO' end as "Situação"
from (values
SQL
  printf '%s\n' "$CHECKS"
  cat <<'SQL'
) as t(ord, item, ok)
order by ord;
SQL
} > atualizar_banco.sql
# só a conferência, para checar o banco sem executar tudo de novo
sed -n '/^-- Conferência/,$p' atualizar_banco.sql | sed '1i -- ---------------------------------------------------------------------' > conferir_banco.sql
echo "gerado: supabase/atualizar_banco.sql e supabase/conferir_banco.sql"
