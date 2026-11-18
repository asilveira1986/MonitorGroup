-- =====================================================================
-- Ignorar mensagens antigas nas pendências.
--
--  * app_settings.pending_ignore_before: mensagens recebidas ANTES desta data/hora
--    não contam como pendentes (aguardando resposta, Pendente empresa/cliente).
--    Vazio = tudo conta, como antes.
--  * apply_pending_cutoff(empresa): marca as mensagens anteriores à data como
--    "não pede resposta" (grupos e conversas privadas) e recalcula os grupos que
--    estavam pendentes por elas, sem descartar as pendências novas.
--  * set_pending_ignore_before(data): administradores definem a data
--    (início do dia, fuso da empresa) em Configurações › Pendências da conversa.
--  * Esta migração define 17/11/2026 para as empresas que ainda não tinham data
--    e aplica o corte uma vez.
-- =====================================================================

alter table public.app_settings add column if not exists pending_ignore_before timestamptz;

create or replace function public.apply_pending_cutoff(p_company uuid)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_cut timestamptz;
  v_n int;
  v_g record;
begin
  select pending_ignore_before into v_cut from public.app_settings where company_id = p_company;
  if v_cut is null then
    return 0;
  end if;
  update public.messages m set opens_pending = false
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company and not m.from_team and m.opens_pending and m.sent_at < v_cut;
  get diagnostics v_n = row_count;
  if to_regclass('public.private_messages') is not null then
    execute 'update public.private_messages set opens_pending = false where company_id = $1 and not from_me and opens_pending and sent_at < $2'
      using p_company, v_cut;
  end if;
  -- grupos que estavam aguardando por mensagens anteriores ao corte: recalcula (sem data de corte de 24 h do histórico)
  for v_g in select id from public.groups where company_id = p_company and pending_since is not null and pending_since < v_cut loop
    perform public.rebuild_group_state(v_g.id, timestamptz 'epoch');
  end loop;
  -- a pendência da conversa (Pendente empresa/cliente) é refeita pelo worker
  update public.groups set followup_updated_at = null where company_id = p_company and followup_status is not null;
  return v_n;
end;
$$;
revoke all on function public.apply_pending_cutoff(uuid) from public, anon, authenticated;
grant execute on function public.apply_pending_cutoff(uuid) to service_role;

create or replace function public.set_pending_ignore_before(p_date date)
returns int
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.current_company_id();
  v_tz text;
begin
  if not public.is_admin() then
    raise exception 'Só administradores mudam esta configuração.' using errcode = '42501';
  end if;
  select coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_tz from public.app_settings where company_id = v_company;
  update public.app_settings
     set pending_ignore_before = case when p_date is null then null else (p_date::timestamp at time zone coalesce(v_tz, 'America/Sao_Paulo')) end,
         updated_at = now()
   where company_id = v_company;
  return public.apply_pending_cutoff(v_company);
end;
$$;
revoke all on function public.set_pending_ignore_before(date) from public, anon;
grant execute on function public.set_pending_ignore_before(date) to authenticated;

-- 17/11/2026 para quem ainda não tinha data, e aplica o corte
update public.app_settings
   set pending_ignore_before = (timestamp '2026-11-17 00:00:00' at time zone coalesce(nullif(timezone, ''), 'America/Sao_Paulo'))
 where pending_ignore_before is null;
select public.apply_pending_cutoff(company_id) from public.app_settings where pending_ignore_before is not null;
