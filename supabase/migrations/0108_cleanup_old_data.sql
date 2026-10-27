-- =====================================================================
-- Otimização: limpeza do que fica guardado sem uso e índices novos.
--
--  * cleanup_old_data() (o worker chama uma vez por dia):
--    - filas de envio já resolvidas (respostas, encaminhadas e avisos do
--      painel, enviadas ou com falha) há mais de 30 dias: a mensagem em si
--      continua na conversa;
--    - pedidos de editar/apagar/reagir já resolvidos há mais de 30 dias;
--    - confirmações de entrega/leitura de mensagens com mais de 60 dias
--      (os tiques só importam nas recentes);
--    - log de atividades com mais de 1 ano (o de LGPD fica);
--    - repetições da agenda sem nenhum compromisso.
--  * storage_orphans(): arquivos guardados que nada mais usa (áudio
--    gravado que já foi enviado, foto/logo trocados, envio abandonado),
--    com mais de 3 dias; o worker apaga do Storage.
--  * Os setores da agenda (0097), já copiados para os Setores (0107), saem.
--  * Índices para a agenda e os lembretes.
-- =====================================================================

create index if not exists agenda_events_company_starts_idx on public.agenda_events (company_id, starts_at);
create index if not exists agenda_events_open_starts_idx on public.agenda_events (starts_at) where done_at is null;
create index if not exists outgoing_messages_done_idx on public.outgoing_messages (created_at) where status in ('sent', 'failed');
create index if not exists private_outgoing_done_idx on public.private_outgoing (created_at) where status in ('sent', 'failed');

create or replace function public.cleanup_old_data()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_out int; n_pout int; n_act int; n_pact int; n_rec int; n_log int; n_series int;
begin
  delete from public.outgoing_messages where status in ('sent', 'failed') and created_at < now() - interval '30 days';
  get diagnostics n_out = row_count;
  delete from public.private_outgoing where status in ('sent', 'failed') and created_at < now() - interval '30 days';
  get diagnostics n_pout = row_count;
  delete from public.message_actions where status in ('done', 'failed') and created_at < now() - interval '30 days';
  get diagnostics n_act = row_count;
  delete from public.private_actions where status in ('done', 'failed') and created_at < now() - interval '30 days';
  get diagnostics n_pact = row_count;
  delete from public.message_receipts r
   using public.messages m
   where m.id = r.message_id and m.sent_at < now() - interval '60 days';
  get diagnostics n_rec = row_count;
  delete from public.activity_log where created_at < now() - interval '365 days' and category is distinct from 'lgpd';
  get diagnostics n_log = row_count;
  delete from public.agenda_series s where not exists (select 1 from public.agenda_events e where e.series_id = s.id);
  get diagnostics n_series = row_count;
  return jsonb_build_object('respostas', n_out, 'privadas', n_pout, 'acoes', n_act + n_pact, 'confirmacoes', n_rec,
                            'log', n_log, 'repeticoes', n_series);
end;
$$;
revoke all on function public.cleanup_old_data() from public, anon, authenticated;
grant execute on function public.cleanup_old_data() to service_role;

-- arquivos do Storage que nada usa (o worker apaga em lotes)
create or replace function public.storage_orphans(p_limit int default 500)
returns setof text language sql stable security definer set search_path = public, storage as $$
  select o.name
    from storage.objects o
   where o.bucket_id = 'media'
     and o.created_at < now() - interval '3 days'
     and not exists (select 1 from public.messages m where m.media_path = o.name)
     and not exists (select 1 from public.private_messages m where m.media_path = o.name)
     and not exists (select 1 from public.outgoing_messages q where q.media_path = o.name)
     and not exists (select 1 from public.private_outgoing q where q.media_path = o.name)
     and not exists (select 1 from public.profiles p where p.photo_path = o.name)
     and not exists (select 1 from public.team_members t where t.photo_path = o.name)
     and not exists (select 1 from public.companies c where c.logo_path = o.name)
     and not exists (select 1 from public.contact_avatars a where a.path = o.name or a.full_path = o.name)
   order by o.created_at
   limit greatest(1, least(p_limit, 1000))
$$;
revoke all on function public.storage_orphans(int) from public, anon, authenticated;
grant execute on function public.storage_orphans(int) to service_role;

-- os setores da agenda viraram Setores (0107): as tabelas saem
drop table if exists public.agenda_team_members;
drop table if exists public.agenda_teams;
