-- =====================================================================
-- Verificação completa de quem é cliente e quem é da equipe.
--
-- O "Recalcular grupos" passa a varrer as mensagens desde a primeira:
--  * remetente só com o LID: o telefone vem da lista de membros de
--    qualquer grupo da empresa e dos contatos do WhatsApp (0069), não só
--    do próprio grupo;
--  * mensagens do número conectado (celular ou painel) contam como da
--    equipe;
--  * mensagens marcadas como da equipe de quem foi apagado do cadastro e
--    não bate com ninguém da equipe voltam a ser do cliente;
--  * tempos de resposta, pendências e indicadores são refeitos.
-- Executado uma vez em todas as empresas ao rodar este script.
-- =====================================================================

create index if not exists group_participants_lid_idx on public.group_participants (lid) where lid is not null;

create or replace function public.recalc_company_groups(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_g          record;
  v_reclass    int := 0;
  v_unmark     int := 0;
  v_n          int := 0;
  v_before     int;
  v_after      int;
  v_groups     int := 0;
  v_alerts     int := 0;
  v_new        public.groups%rowtype;
begin
  if p_company_id is null then
    raise exception 'empresa não informada';
  end if;

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
         where w.company_id = p_company_id and w.phone is not null and (w.jid = m.sender_jid or w.lid = m.sender_jid) limit 1))
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company_id
     and m.sender_phone is null and not m.from_me and m.sender_jid like '%@lid';

  -- mensagens do próprio número conectado (celular ou painel) são sempre da equipe
  update public.messages m set from_team = true
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company_id and m.from_me and not m.from_team;
  get diagnostics v_reclass = row_count;

  -- 1) mensagens da equipe que estavam como de cliente
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
              and public.phone_key(m.sender_phone) = public.phone_key(t.phone)));
  get diagnostics v_n = row_count;
  v_reclass := v_reclass + v_n;

  -- 1b) mensagens como da equipe de quem não é (nem foi) da equipe: a pessoa saiu do
  --     cadastro (apagada, não só desativada) e não bate com ninguém da equipe
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
                   and public.phone_key(m.sender_phone) = public.phone_key(t.phone))));
  get diagnostics v_unmark = row_count;

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
    'mensagens_reclassificadas', v_reclass + v_unmark,
    'mensagens_da_equipe', v_reclass,
    'mensagens_de_cliente', v_unmark,
    'grupos_recalculados', v_groups,
    'aguardando_antes', v_before,
    'aguardando_depois', v_after,
    'alertas_resolvidos', v_alerts
  );
end;
$$;


revoke all on function public.recalc_company_groups(uuid) from public, anon, authenticated;
grant execute on function public.recalc_company_groups(uuid) to service_role;

-- verificação completa, em todas as empresas
do $$
declare v_c uuid; v_r jsonb;
begin
  for v_c in select id from public.companies loop
    v_r := public.recalc_company_groups(v_c);
    raise notice 'empresa %: %', v_c, v_r;
  end loop;
end $$;
