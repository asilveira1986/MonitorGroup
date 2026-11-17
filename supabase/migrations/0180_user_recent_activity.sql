-- =====================================================================
-- Acompanhamento: últimas atividades de um usuário.
--
-- Ao clicar no usuário na tela Acompanhamento, mostra o que ele fez no
-- sistema (a lista do Log: configurações, grupos, respostas enviadas,
-- demandas, alertas...). O Log em si continua só do administrador da
-- plataforma; esta função devolve, de um usuário, as últimas ações:
--  * administrador da plataforma: de qualquer usuário;
--  * administrador de uma empresa: só de usuários da própria empresa, e
--    nunca de quem administra a plataforma.
-- =====================================================================

create or replace function public.user_recent_activity(p_email text, p_limit int default 40)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_target public.profiles%rowtype;
begin
  if not public.is_admin() then
    raise exception 'Só administradores veem as atividades dos usuários.' using errcode = '42501';
  end if;
  select * into v_target from public.profiles where lower(email) = lower(p_email) limit 1;
  if not found then
    return '[]'::jsonb;
  end if;
  if not public.is_platform_admin() and (v_target.company_id is distinct from public.current_company_id() or coalesce(v_target.platform_admin, false)) then
    raise exception 'Usuário não encontrado.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', x.created_at, 'category', x.category, 'action', x.action, 'entity', x.entity, 'summary', x.summary) order by x.created_at desc)
      from (
        select l.created_at, l.category, l.action, l.entity, l.summary
          from public.activity_log l
         where (l.user_id = v_target.id or lower(l.user_email) = lower(v_target.email))
         order by l.created_at desc
         limit least(greatest(coalesce(p_limit, 40), 1), 100)
      ) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.user_recent_activity(text, int) from public, anon;
grant execute on function public.user_recent_activity(text, int) to authenticated;
