-- =====================================================================
-- Agenda: alerta dentro do sistema na hora de cada lembrete.
--
-- O push (celular e computador) e o WhatsApp já avisam nos lembretes
-- (queue_scheduled_pushes, 0098/0101). Com o sistema aberto, a tela agora
-- também mostra o alerta, com som e voz, no mesmo horário.
-- my_agenda_reminders(): os lembretes do usuário que tocaram nos últimos 15
-- minutos (mesma regra do push: minutos antes do horário; dia todo, a partir
-- das 8h do dia), dos compromissos de que ele participa (ou da pessoa da
-- equipe ligada a ele) e ainda não concluídos. A tela não repete o mesmo
-- lembrete (guarda o que já mostrou neste navegador).
-- =====================================================================

create or replace function public.my_agenda_reminders()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', x.id, 'title', x.title, 'starts_at', x.starts_at, 'all_day', x.all_day, 'minutes', x.m,
           'fire_at', x.fire_at, 'nature', x.nature, 'label', public.agenda_reminder_label(x.m, x.all_day))
         order by x.fire_at), '[]'::jsonb)
    from (
      select e.id, e.title, e.starts_at, e.all_day, e.nature, r.m, r.base - make_interval(mins => r.m) as fire_at
        from public.agenda_events e
        left join public.app_settings s on s.company_id = e.company_id
        cross join lateral unnest(e.reminders) as r0(m)
        cross join lateral (
          select r0.m as m,
                 case when e.all_day
                      then (((e.starts_at at time zone coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'))::date + time '08:00')
                            at time zone coalesce(nullif(s.timezone, ''), 'America/Sao_Paulo'))
                      else e.starts_at end as base
        ) r
       where public.is_active_user()
         and e.company_id = public.current_company_id()
         and e.done_at is null
         and e.starts_at > now() - interval '1 day' and e.starts_at < now() + interval '29 days'
         and (exists (select 1 from public.agenda_event_people p where p.event_id = e.id and p.user_id = auth.uid())
              or e.member_id = any(public.my_team_member_ids()))
         and r.base - make_interval(mins => r.m) <= now()
         and r.base - make_interval(mins => r.m) > now() - interval '15 minutes'
    ) x
$$;
revoke all on function public.my_agenda_reminders() from public, anon;
grant execute on function public.my_agenda_reminders() to authenticated;
