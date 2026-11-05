-- =====================================================================
-- Excluir a regra de automação de um grupo encerra o que ficou aberto nele.
--
-- Sem a regra, o verificador de cobranças não cuida mais da demanda: ela ficaria aberta para sempre e o alerta
-- em tela (new_message / no_reply) continuaria no painel. Ao excluir a regra, a demanda aberta do grupo é
-- encerrada ("regra excluída"), os alertas da automação saem da tela e o fato fica no histórico.
-- =====================================================================

create or replace function public.automation_rule_deleted()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_closed int;
begin
  update public.automation_pending
     set resolved_at = now(), resolved_by = 'regra excluída',
         response_sec = greatest(0, extract(epoch from now() - received_at)::int)
   where group_id = old.group_id and resolved_at is null;
  get diagnostics v_closed = row_count;
  if v_closed > 0 then
    update public.alerts set status = 'resolved', resolved_at = now()
     where group_id = old.group_id and type in ('new_message', 'no_reply') and status <> 'resolved';
    insert into public.automation_log (company_id, group_id, action, detail)
    values (old.company_id, old.group_id, 'RESOLVED', 'demanda encerrada porque a regra foi excluída');
  end if;
  return old;
end;
$$;
revoke all on function public.automation_rule_deleted() from public, anon, authenticated;

drop trigger if exists automation_rule_deleted on public.automation_rules;
create trigger automation_rule_deleted after delete on public.automation_rules
  for each row execute function public.automation_rule_deleted();

notify pgrst, 'reload schema';
