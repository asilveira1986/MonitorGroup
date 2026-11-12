-- =====================================================================
-- Conferência das pendências: grupos hoje como "Pendente empresa" ou
-- "Pendente cliente", com o motivo e o trecho que o sistema usou.
-- Só consulta (não altera nada). Serve para revisar se há pendências
-- indevidas: mande o resultado (ou os casos errados) para ajustar as regras.
-- =====================================================================

-- 1) Todas as pendências abertas, mais antigas primeiro
select c.name                                  as empresa,
       g.name                                  as grupo,
       case g.followup_status when 'company' then 'Pendente empresa' when 'client' then 'Pendente cliente' end as situacao,
       g.followup_kind                         as tipo,
       g.followup_reason                       as motivo,
       g.followup_trigger                      as gatilho,
       g.followup_actor                        as quem,
       left(g.followup_excerpt, 200)           as trecho,
       g.followup_since                        as desde,
       g.followup_due_at                       as prazo
from public.groups g
join public.companies c on c.id = g.company_id
where g.removed_at is null and g.monitored and g.followup_status in ('company', 'client')
order by g.followup_status, g.followup_kind, g.followup_since;

-- 2) Resumo por tipo (onde estão os erros mais prováveis: "reply" = mensagem do cliente sem pergunta nem pedido)
select g.followup_status as situacao, g.followup_kind as tipo, count(*) as grupos
from public.groups g
where g.removed_at is null and g.monitored and g.followup_status in ('company', 'client')
group by 1, 2
order by 3 desc;
