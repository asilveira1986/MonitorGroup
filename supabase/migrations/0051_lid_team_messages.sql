-- =====================================================================
-- Mensagens da equipe que chegaram só com o LID eram tratadas como do
-- cliente.
--
-- O WhatsApp às vezes identifica o remetente só pelo LID (identificador
-- interno, sem o número). Como a equipe é reconhecida pelo telefone, a
-- mensagem ficava como "Cliente", sem nome nem telefone, e o grupo ficava
-- aguardando resposta à toa. O worker passa a descobrir o número do LID;
-- aqui o "Recalcular grupos" também completa telefone e nome dessas
-- mensagens pela lista de membros e as reconhece como da equipe, e é
-- executado uma vez em todas as empresas para corrigir o que já foi gravado.
-- =====================================================================

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

  -- 0) mensagens que chegaram só com o LID (sem telefone): completa telefone e nome pela
  --    lista de membros do grupo, para a equipe ser reconhecida abaixo
  update public.messages m
     set sender_phone = gp.phone,
         sender_name = coalesce(m.sender_name, nullif(gp.name, ''))
    from public.groups g, public.group_participants gp
   where g.id = m.group_id and g.company_id = p_company_id
     and gp.group_id = m.group_id
     and m.sender_phone is null and not m.from_me
     and m.sender_jid is not null and gp.phone is not null
     and m.sender_jid in (gp.jid, gp.lid);

  -- 1) mensagens da equipe que estavam como de cliente
  update public.messages m
     set from_team = true, team_member_id = t.id, sender_name = coalesce(m.sender_name, t.name)
    from public.groups g, public.team_members t
   where g.id = m.group_id and g.company_id = p_company_id
     and t.company_id = p_company_id and t.active
     and not m.from_team
     and ((t.jid is not null and m.sender_jid = t.jid)
          -- equipe cadastrada pelo telefone, mensagem só com o LID desse telefone
          or (t.phone is not null and m.sender_jid like '%@lid' and exists (
                select 1 from public.group_participants gp
                where gp.group_id = m.group_id and gp.lid = m.sender_jid and gp.phone is not null
                  and public.phone_key(gp.phone) = public.phone_key(t.phone)))
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

-- corrige o que já foi gravado, em todas as empresas
do $$
declare v_c uuid; v_r jsonb;
begin
  for v_c in select id from public.companies loop
    v_r := public.recalc_company_groups(v_c);
    raise notice 'empresa %: %', v_c, v_r;
  end loop;
end $$;
