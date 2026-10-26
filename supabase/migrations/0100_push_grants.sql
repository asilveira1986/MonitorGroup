-- =====================================================================
-- Notificações push: garante que o worker (chave de serviço) lê e grava
-- as tabelas das notificações, mesmo em bancos em que as permissões
-- padrão das tabelas novas não incluem a chave de serviço.
-- =====================================================================

grant select, insert, update, delete on public.push_config, public.push_subscriptions, public.push_events to service_role;
grant usage, select on all sequences in schema public to service_role;
grant execute on function public.claim_push_deliveries(int), public.push_delivery_result(uuid, boolean, boolean),
  public.queue_scheduled_pushes() to service_role;
