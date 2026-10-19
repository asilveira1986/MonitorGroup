-- =====================================================================
-- Recalcular os grupos depois de cadastrar a equipe.
--
-- Quando alguém entra na equipe depois de já ter falado nos grupos, as
-- mensagens antigas dele estavam contando como de cliente: o grupo ficava
-- "aguardando resposta" mesmo já respondido. Esta rotina:
--   1. marca como da equipe as mensagens dos números/ids da equipe ativa;
--   2. recalcula, grupo a grupo, pendência, tempos de resposta e última
--      mensagem (a pendência só pode diminuir: nada que já estava resolvido
--      volta a ficar pendente);
--   3. resolve os alertas de "sem resposta" dos grupos que ficaram em dia.
--
-- No painel: Configurações › Equipe › "Recalcular grupos" (e roda sozinha
-- ao cadastrar alguém). No SQL Editor:
--   select public.recalc_company_groups(id) from public.companies where name ilike '%nome%';
-- =====================================================================

-- telefone comparável: DDD + 8 últimos dígitos (tolera o 9º dígito e o 55)
create or replace function public.phone_key(p_phone text)
returns text
language sql immutable
as $$
  select case
    when p_phone is null then null
    else regexp_replace(regexp_replace(p_phone, '\D', '', 'g'), '^(?:55)?(\d{2})9?(\d{8})$', '\1\2')
  end;
$$;

create or replace function public.recalc_company_groups(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_g          record;
  v_reclass    int := 0;
  v_before     int;
  v_after      int;
  v_groups     int := 0;
  v_alerts     int := 0;
  v_new        public.groups%rowtype;
begin
  if p_company_id is null then
    raise exception 'empresa não informada';
  end if;

  -- 1) mensagens da equipe que estavam como de cliente
  update public.messages m
     set from_team = true, team_member_id = t.id
    from public.groups g, public.team_members t
   where g.id = m.group_id and g.company_id = p_company_id
     and t.company_id = p_company_id and t.active
     and not m.from_team
     and ((t.jid is not null and m.sender_jid = t.jid)
          or (t.phone is not null and m.sender_phone is not null
              and public.phone_key(m.sender_phone) = public.phone_key(t.phone)));
  get diagnostics v_reclass = row_count;

  select count(*) into v_before from public.groups
   where company_id = p_company_id and pending_since is not null and removed_at is null;

  -- 2) situação de cada grupo
  for v_g in
    select id, pending_since, pending_message_id, pending_count
      from public.groups where company_id = p_company_id
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

  select count(*) into v_after from public.groups
   where company_id = p_company_id and pending_since is not null and removed_at is null;

  -- 3) alertas de "sem resposta" de grupos que ficaram em dia
  update public.alerts a set status = 'resolved', resolved_at = now()
    from public.groups g
   where g.id = a.group_id and g.company_id = p_company_id and g.pending_since is null
     and a.type = 'no_response' and a.status <> 'resolved';
  get diagnostics v_alerts = row_count;

  return jsonb_build_object(
    'mensagens_reclassificadas', v_reclass,
    'grupos_recalculados', v_groups,
    'aguardando_antes', v_before,
    'aguardando_depois', v_after,
    'alertas_resolvidos', v_alerts
  );
end;
$$;

revoke all on function public.recalc_company_groups(uuid) from public, anon, authenticated;
grant execute on function public.recalc_company_groups(uuid) to service_role;

-- painel: botão "Recalcular grupos" (administrador, empresa atual)
create or replace function public.recalc_groups()
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Somente administradores recalculam os grupos.';
  end if;
  return public.recalc_company_groups(public.current_company_id());
end;
$$;

revoke all on function public.recalc_groups() from public, anon;
grant execute on function public.recalc_groups() to authenticated;
