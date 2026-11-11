-- =====================================================================
-- Agenda: só quem criou o compromisso pode excluí-lo.
--
-- Antes, quem podia editar (administrador, participante, pessoa ligada)
-- também excluía. Agora a exclusão é só de quem inseriu (owner_id; nos
-- antigos sem dono, created_by). Editar e concluir continuam como estavam.
-- =====================================================================

create or replace function public.can_delete_agenda_event(p_event_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_edit_agenda_event(p_event_id)
     and exists (
       select 1 from public.agenda_events e
        where e.id = p_event_id and coalesce(e.owner_id, e.created_by) = auth.uid())
$$;
revoke all on function public.can_delete_agenda_event(uuid) from public, anon;
grant execute on function public.can_delete_agenda_event(uuid) to authenticated;

-- excluir uma ocorrência ou "este e os próximos": só o criador
create or replace function public.delete_agenda_event(p_id uuid, p_scope text default 'one')
returns void language plpgsql security definer set search_path = public as $$
declare
  e public.agenda_events%rowtype;
begin
  if not public.can_edit_agenda_event(p_id) then
    raise exception 'Compromisso não encontrado.';
  end if;
  if not public.can_delete_agenda_event(p_id) then
    raise exception 'Só quem criou o compromisso pode excluí-lo.';
  end if;
  select * into e from public.agenda_events where id = p_id;
  if p_scope = 'following' and e.series_id is not null then
    perform public.agenda_series_stop(e.series_id, e.starts_at);
    delete from public.agenda_events where series_id = e.series_id and starts_at >= e.starts_at;
  else
    delete from public.agenda_events where id = p_id;
  end if;
end;
$$;
revoke all on function public.delete_agenda_event(uuid, text) from public, anon;
grant execute on function public.delete_agenda_event(uuid, text) to authenticated;

-- exclusão direta na tabela segue a mesma regra
drop policy if exists agenda_events_delete on public.agenda_events;
create policy agenda_events_delete on public.agenda_events for delete using (public.can_delete_agenda_event(id));
