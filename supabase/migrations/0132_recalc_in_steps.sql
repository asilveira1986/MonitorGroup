-- =====================================================================
-- "Recalcular grupos" em etapas curtas.
--
-- Com muitas mensagens, o recálculo inteiro numa operação só passava do
-- limite de 8 s do Supabase para quem está logado ("canceling statement
-- due to statement timeout"). Agora a tela faz em etapas, cada uma curta:
--   1) recalc_company_reclassify: quem é equipe e quem é cliente;
--   2) recalc_company_rebuild: a situação dos grupos, em lotes;
--   3) recalc_company_finish: alertas de "sem resposta" resolvidos.
-- recalc_company_groups_core (usado ao mudar a equipe) faz as três etapas,
-- com o mesmo resultado de antes.
-- =====================================================================

-- 1) mensagens: completa remetentes e separa equipe x cliente
create or replace function public.recalc_company_reclassify(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_reclass    int := 0;
  v_unmark     int := 0;
  v_n          int := 0;
  v_before     int;
  v_ids        uuid[] := '{}';   -- grupos com mensagens que mudaram de lado (cliente × equipe)
  v_part       uuid[];
begin
  if p_company_id is null then
    raise exception 'empresa não informada';
  end if;
  select count(*) into v_before from public.groups
   where company_id = p_company_id and pending_since is not null and removed_at is null;

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
         where w.company_id = p_company_id and w.phone is not null and (w.jid = m.sender_jid or w.lid = m.sender_jid) limit 1),
       public.lid_phone(g.instance_id, m.sender_jid))
    from public.groups g
   where g.id = m.group_id and g.company_id = p_company_id
     and m.sender_phone is null and not m.from_me and m.sender_jid like '%@lid';

  -- mensagens sem remetente nenhum (o WhatsApp não informou): se o grupo só tem uma pessoa além
  -- do número conectado, a mensagem é dela (0081)
  update public.messages m
     set sender_jid = c.jid, sender_phone = c.phone, sender_name = coalesce(m.sender_name, nullif(c.name, ''))
    from public.groups g,
         lateral (
           select (array_agg(gp.jid))[1] as jid, (array_agg(gp.phone))[1] as phone, (array_agg(gp.name))[1] as name, count(*) as n
             from public.group_participants gp
             left join public.whatsapp_instances w on w.id = g.instance_id
            where gp.group_id = g.id and gp.left_at is null
              and (w.phone is null or gp.phone is null
                   or public.phone_key(gp.phone) is distinct from public.phone_key(regexp_replace(w.phone, '\D', '', 'g')))
         ) c
   where g.id = m.group_id and g.company_id = p_company_id
     and m.sender_jid is null and m.sender_phone is null and not m.from_me
     and c.n = 1 and c.jid is not null;

  -- mensagens do próprio número conectado (celular ou painel) são sempre da equipe
  with u as (
    update public.messages m set from_team = true
      from public.groups g
     where g.id = m.group_id and g.company_id = p_company_id and m.from_me and not m.from_team
    returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_reclass, v_part from u;
  v_ids := v_ids || v_part;

  -- 1) mensagens da equipe que estavam como de cliente
  with u as (
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
              and public.phone_key(m.sender_phone) = public.phone_key(t.phone)))
  returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_n, v_part from u;
  v_reclass := v_reclass + v_n;
  v_ids := v_ids || v_part;

  -- 1b) mensagens como da equipe de quem não é (nem foi) da equipe: a pessoa saiu do
  --     cadastro (apagada, não só desativada) e não bate com ninguém da equipe
  with u as (
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
                   and public.phone_key(m.sender_phone) = public.phone_key(t.phone))))
  returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_unmark, v_part from u;
  v_ids := v_ids || v_part;

  return jsonb_build_object('reclass', v_reclass, 'unmark', v_unmark, 'before', v_before,
                            'changed_ids', to_jsonb(coalesce((select array_agg(distinct x) from unnest(v_ids) x), '{}')));
end;
$$;
revoke all on function public.recalc_company_reclassify(uuid) from public, anon, authenticated;
grant execute on function public.recalc_company_reclassify(uuid) to service_role;

-- 2) situação de alguns grupos (um lote)
create or replace function public.recalc_company_rebuild(p_company_id uuid, p_ids uuid[])
returns int
language plpgsql security definer set search_path = public
as $$
declare
  v_g      record;
  v_new    public.groups%rowtype;
  v_groups int := 0;
begin
  -- 2) situação de cada grupo
  for v_g in
    select id, pending_since, pending_message_id, pending_count
      from public.groups
     where company_id = p_company_id and id = any(p_ids)
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

  return v_groups;
end;
$$;
revoke all on function public.recalc_company_rebuild(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.recalc_company_rebuild(uuid, uuid[]) to service_role;

-- 3) alertas e o total de "aguardando" no fim
create or replace function public.recalc_company_finish(p_company_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_alerts int := 0;
  v_after  int;
begin
  -- 3) alertas de "sem resposta" de grupos que ficaram em dia
  update public.alerts a set status = 'resolved', resolved_at = now()
    from public.groups g
   where g.id = a.group_id and g.company_id = p_company_id and g.pending_since is null
     and a.type = 'no_response' and a.status <> 'resolved';
  get diagnostics v_alerts = row_count;

  select count(*) into v_after from public.groups
   where company_id = p_company_id and pending_since is not null and removed_at is null;
  return jsonb_build_object('after', v_after, 'alerts', v_alerts);
end;
$$;
revoke all on function public.recalc_company_finish(uuid) from public, anon, authenticated;
grant execute on function public.recalc_company_finish(uuid) to service_role;

-- as três etapas juntas (ao mudar a equipe; mesmo resultado de antes)
create or replace function public.recalc_company_groups_core(p_company_id uuid, p_only_changed boolean)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_r   jsonb := public.recalc_company_reclassify(p_company_id);
  v_ids uuid[];
  v_n   int;
  v_f   jsonb;
begin
  v_ids := case when p_only_changed
                then array(select jsonb_array_elements_text(v_r->'changed_ids')::uuid)
                else array(select id from public.groups where company_id = p_company_id) end;
  v_n := public.recalc_company_rebuild(p_company_id, v_ids);
  v_f := public.recalc_company_finish(p_company_id);
  return jsonb_build_object(
    'mensagens_reclassificadas', (v_r->>'reclass')::int + (v_r->>'unmark')::int,
    'mensagens_da_equipe', (v_r->>'reclass')::int,
    'mensagens_de_cliente', (v_r->>'unmark')::int,
    'grupos_recalculados', v_n,
    'aguardando_antes', (v_r->>'before')::int,
    'aguardando_depois', (v_f->>'after')::int,
    'alertas_resolvidos', (v_f->>'alerts')::int
  );
end;
$$;
revoke all on function public.recalc_company_groups_core(uuid, boolean) from public, anon, authenticated;
grant execute on function public.recalc_company_groups_core(uuid, boolean) to service_role;
