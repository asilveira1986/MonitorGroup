-- =====================================================================
-- Conferência dos grupos: responsáveis e status.
-- Só consulta (não altera nada). Rode no SQL Editor do Supabase; cada bloco
-- (1 a 5) mostra uma tabela — o SQL Editor exibe o resultado do último
-- comando, então rode um bloco por vez (selecione e clique em Run).
-- =====================================================================

-- 1) Todos os grupos: empresa, setor, número, responsáveis e status ----------
select
  c.name                                   as empresa,
  g.name                                   as grupo,
  coalesce(s.name, '— sem setor —')        as setor,
  i.name                                   as numero,
  i.status                                 as status_numero,
  coalesce((select string_agg(t.name, ', ' order by o)
              from unnest(g.responsible_member_ids) with ordinality u(x, o)
              join public.team_members t on t.id = u.x), '— sem responsável —') as responsaveis,
  case when g.removed_at is not null then 'Removido do WhatsApp'
       when not g.monitored           then 'Monitoramento desligado'
       else 'Monitorado' end               as monitoramento,
  case when g.pending_since is not null then 'Aguardando resposta (SLA)'
       else 'Em dia' end                   as atendimento,
  case g.followup_status when 'company'  then 'Pendente empresa'
                         when 'client'   then 'Pendente cliente'
                         when 'resolved' then 'Resolvido'
                         else '—' end      as pendencia,
  g.sla_minutes                            as sla_min,
  g.pending_since                          as aguardando_desde,
  g.last_message_at                        as ultima_mensagem,
  g.removed_reason                         as motivo_remocao
from public.groups g
join public.companies c          on c.id = g.company_id
join public.whatsapp_instances i on i.id = g.instance_id
left join public.sectors s       on s.id = g.sector_id
order by c.name, g.removed_at is not null, not g.monitored, g.name;

-- 2) Grupos monitorados SEM responsável ---------------------------------------
select c.name as empresa, g.name as grupo, coalesce(s.name, '— sem setor —') as setor,
       i.name as numero, g.last_message_at as ultima_mensagem
from public.groups g
join public.companies c          on c.id = g.company_id
join public.whatsapp_instances i on i.id = g.instance_id
left join public.sectors s       on s.id = g.sector_id
where g.monitored and g.removed_at is null
  and coalesce(array_length(g.responsible_member_ids, 1), 0) = 0
order by c.name, g.name;

-- 3) Resumo por status ----------------------------------------------------------
select
  count(*)                                                                as total,
  count(*) filter (where g.monitored and g.removed_at is null)            as monitorados,
  count(*) filter (where not g.monitored and g.removed_at is null)        as monitoramento_desligado,
  count(*) filter (where g.removed_at is not null)                        as removidos,
  count(*) filter (where g.monitored and g.removed_at is null
                     and coalesce(array_length(g.responsible_member_ids, 1), 0) = 0) as sem_responsavel,
  count(*) filter (where g.pending_since is not null)                     as aguardando_resposta,
  count(*) filter (where g.followup_status = 'company')                   as pendente_empresa,
  count(*) filter (where g.followup_status = 'client')                    as pendente_cliente
from public.groups g;

-- 4) Quantos grupos monitorados cada pessoa da equipe tem como responsável ---
select c.name as empresa, t.name as pessoa,
       count(g.id)                                                   as grupos,
       count(g.id) filter (where g.pending_since is not null)        as aguardando_resposta,
       count(g.id) filter (where g.followup_status = 'company')      as pendente_empresa
from public.team_members t
join public.companies c on c.id = t.company_id
left join public.groups g
       on t.id = any(g.responsible_member_ids) and g.monitored and g.removed_at is null
group by c.name, t.name
order by c.name, grupos desc, t.name;

-- 5) Números (WhatsApp): conexão e quantos grupos cada um tem --------------------
select i.name as numero, i.phone as telefone, i.status, i.last_seen_at as visto_em, i.last_error as ultimo_erro,
       count(g.id) filter (where g.removed_at is null)                       as grupos,
       count(g.id) filter (where g.monitored and g.removed_at is null)       as monitorados
from public.whatsapp_instances i
left join public.groups g on g.instance_id = i.id
group by i.id
order by i.name;
