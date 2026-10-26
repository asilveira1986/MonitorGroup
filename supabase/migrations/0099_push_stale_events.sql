-- =====================================================================
-- Notificações push: avisos parados na fila não chegam atrasados.
--
-- Enquanto o worker está fora do ar (ou ainda sem a versão das
-- notificações), os avisos ficam na fila. Quando ele volta, os com mais
-- de 30 minutos saem da fila sem enviar (um "cliente sem resposta" de
-- horas atrás não deve tocar no celular). As chaves de envio agora
-- também podem ser geradas pelo painel, ao ativar as notificações.
-- =====================================================================

create or replace function public.claim_push_deliveries(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ev public.push_events%rowtype;
  u record;
  v_out jsonb := '[]'::jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_ok boolean;
begin
  for ev in
    select * from public.push_events where processed_at is null order by id limit greatest(1, least(p_limit, 200))
    for update skip locked
  loop
    -- aviso velho (worker fora do ar ou desatualizado): não chega atrasado; só sai da fila
    if ev.created_at < now() - interval '30 minutes' then
      update public.push_events set processed_at = now() where id = ev.id;
      continue;
    end if;
    for u in
      select p.id
        from public.profiles p
       where p.company_id = ev.company_id and p.active
         and (p.id <> ev.actor_id or ev.actor_id is null or ev.kind = 'test')
         and coalesce((p.push_prefs ->> case when ev.kind = 'test' then 'none' else ev.kind end)::boolean, true)
         and exists (select 1 from public.push_subscriptions s where s.user_id = p.id)
         and (ev.audience <> 'users' or p.id = any(ev.target_users))
    loop
      if ev.audience = 'users' then
        v_ok := true;
      else
        -- confere como se fosse o próprio usuário logado
        perform set_config('request.jwt.claim.sub', u.id::text, true);
        perform set_config('request.jwt.claims', jsonb_build_object('sub', u.id, 'role', 'authenticated')::text, true);
        v_ok := case ev.audience
          when 'group' then ev.group_id = any(public.visible_group_ids())
          when 'admins' then public.is_admin()
          when 'private' then public.can_use_private_chats()
          else false end;
        perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
        perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
      end if;
      if v_ok then
        v_out := v_out || coalesce((
          select jsonb_agg(jsonb_build_object(
                   'subscription_id', s.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                   'payload', jsonb_build_object('title', ev.title, 'body', ev.body, 'url', ev.url,
                                                 'tag', coalesce(ev.tag, ev.kind || ':' || ev.id))))
            from public.push_subscriptions s where s.user_id = u.id), '[]'::jsonb);
      end if;
    end loop;
    update public.push_events set processed_at = now() where id = ev.id;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.claim_push_deliveries(int) from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(int) to service_role;
