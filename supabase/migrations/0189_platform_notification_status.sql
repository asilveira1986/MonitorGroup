-- =====================================================================
-- Situação das notificações dos usuários (só administrador geral).
--
-- Uma linha por usuário ativo de todas as empresas: se ele desligou os
-- avisos (profiles.alerts_off), quais tipos de push ele escolheu
-- (push_prefs), quantos aparelhos têm push ativo e se estão entregando
-- (último envio com sucesso / falhas) e quando abriu o sistema pela
-- última vez. A tela "Notificações" usa isto.
-- =====================================================================

create or replace function public.platform_notification_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Só o administrador geral vê a situação das notificações.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id, 'name', coalesce(nullif(btrim(p.full_name), ''), p.email), 'email', p.email, 'role', p.role,
             'company_id', p.company_id, 'company_name', c.name,
             'alerts_off', coalesce(p.alerts_off, false), 'push_prefs', coalesce(p.push_prefs, '{}'::jsonb),
             'last_seen_at', p.last_seen_at,
             'devices', coalesce(s.devices, 0), 'devices_ok', coalesce(s.devices_ok, 0),
             'last_push_ok_at', s.last_ok, 'max_failures', coalesce(s.max_failures, 0)
           ) order by c.name nulls last, lower(coalesce(nullif(btrim(p.full_name), ''), p.email)))
      from public.profiles p
      left join public.companies c on c.id = p.company_id
      left join lateral (
        select count(*)::int as devices,
               count(*) filter (where ps.failures < 3)::int as devices_ok,
               max(ps.last_ok_at) as last_ok,
               max(ps.failures) as max_failures
          from public.push_subscriptions ps where ps.user_id = p.id
      ) s on true
     where p.active
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.platform_notification_status() from public, anon;
grant execute on function public.platform_notification_status() to authenticated;
