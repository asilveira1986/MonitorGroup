-- =====================================================================
-- Mensagens de outro número conectado da empresa contam como da empresa.
--
-- Cada número conectado tem a sua cópia do grupo. Num grupo com dois
-- números da empresa, o que um envia chega ao outro como de um membro
-- qualquer: o sistema só o reconhecia se o telefone estivesse em Pessoas
-- (e aí com o nome da pessoa), senão era cliente. Agora é sempre a
-- empresa, com o nome do número no WhatsApp (o worker faz o mesmo ao
-- receber). As mensagens já gravadas são corrigidas e os grupos
-- afetados, recalculados.
-- =====================================================================

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

  -- 0b) mensagens de outro número conectado da empresa (dois números no mesmo grupo): é a empresa,
  --     com o nome do número no WhatsApp, mesmo que alguém em Pessoas tenha esse telefone (0133)
  with u as (
    update public.messages m
       set from_team = true, team_member_id = null,
           sender_name = coalesce(nullif(w.push_name, ''), nullif(w.name, ''), 'Número da empresa')
      from public.groups g, public.whatsapp_instances w
     where g.id = m.group_id and g.company_id = p_company_id
       and w.company_id = p_company_id and w.phone is not null
       and not m.from_me and m.sender_phone is not null
       and public.phone_key(m.sender_phone) = public.phone_key(w.phone)
       and (not m.from_team or m.team_member_id is not null
            or m.sender_name is distinct from coalesce(nullif(w.push_name, ''), nullif(w.name, ''), 'Número da empresa'))
    returning m.group_id
  )
  select count(*), coalesce(array_agg(distinct group_id), '{}') into v_n, v_part from u;
  v_reclass := v_reclass + v_n;
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
     and not exists (select 1 from public.whatsapp_instances w2
                      where w2.company_id = p_company_id and w2.phone is not null and m.sender_phone is not null
                        and public.phone_key(m.sender_phone) = public.phone_key(w2.phone))
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
     and not exists (select 1 from public.whatsapp_instances w2
                      where w2.company_id = p_company_id and w2.phone is not null and m.sender_phone is not null
                        and public.phone_key(m.sender_phone) = public.phone_key(w2.phone))
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

-- já gravadas: corrige e recalcula só os grupos que mudaram
do $fix$
declare
  c uuid;
begin
  for c in select distinct company_id from public.whatsapp_instances where phone is not null loop
    perform public.recalc_company_groups_core(c, true);
  end loop;
end $fix$;
