-- =====================================================================
-- Agenda: compromisso particular só aparece como "Ocupado" para os outros.
--
--  * Quem vê os detalhes (título, observação, participantes) de um
--    compromisso particular: quem criou, os participantes e a pessoa da
--    equipe ligada a ele. Administradores NÃO veem o particular dos outros
--    (antes viam tudo): a regra está no banco (can_see / can_edit), então
--    vale para qualquer tela, inclusive o filtro da agenda.
--  * agenda_busy(de, até, usuários): os horários dos compromissos
--    particulares que a pessoa NÃO pode ver, só com início, "dia todo" e de
--    quais usuários pedidos são. Sem título, observação, tipo, nem como
--    abrir. A agenda mostra como "Ocupado".
-- =====================================================================

create or replace function public.can_see_agenda_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agenda_events e
     where e.id = p_event_id and e.company_id = public.current_company_id() and public.is_active_user()
       and ((public.is_admin() and e.nature is distinct from 'personal') or e.owner_id = auth.uid()
            or e.member_id = any(public.my_team_member_ids())
            or exists (select 1 from public.agenda_event_people x where x.event_id = e.id and x.user_id = auth.uid())))
$$;
grant execute on function public.can_see_agenda_event(uuid) to authenticated;

create or replace function public.can_edit_agenda_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.agenda_events e
     where e.id = p_event_id and e.company_id = public.current_company_id() and public.can_write()
       and ((public.is_admin() and e.nature is distinct from 'personal') or e.owner_id = auth.uid() or e.member_id = any(public.my_team_member_ids())
            -- participante conclui/reabre e edita o que está na própria agenda
            or exists (select 1 from public.agenda_event_people x where x.event_id = e.id and x.user_id = auth.uid())))
$$;
grant execute on function public.can_edit_agenda_event(uuid) to authenticated;

-- horários "Ocupado": particulares dos usuários pedidos que quem pergunta não pode ver
create or replace function public.agenda_busy(p_from timestamptz, p_to timestamptz, p_users uuid[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('starts_at', b.starts_at, 'all_day', b.all_day, 'user_ids', b.user_ids)
                            order by b.starts_at), '[]'::jsonb)
    from (
      select e.starts_at, e.all_day, array_agg(distinct x.user_id) as user_ids
        from public.agenda_events e
        join public.agenda_event_people x on x.event_id = e.id
       where public.is_active_user()
         and e.company_id = public.current_company_id()
         and e.nature = 'personal'
         and e.done_at is null
         and x.user_id = any(coalesce(p_users, '{}'))
         and e.starts_at >= p_from and e.starts_at < p_to
         and not public.can_see_agenda_event(e.id)
       group by e.id, e.starts_at, e.all_day
       limit 2000
    ) b
$$;
revoke all on function public.agenda_busy(timestamptz, timestamptz, uuid[]) from public, anon;
grant execute on function public.agenda_busy(timestamptz, timestamptz, uuid[]) to authenticated;
