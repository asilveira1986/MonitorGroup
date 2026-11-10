-- =====================================================================
-- Agenda: aviso em tela no instante em que alguém coloca um compromisso na
-- agenda de outra pessoa.
--
-- O push (celular e computador) e o WhatsApp já avisavam (agenda_people_push).
-- Com o sistema aberto, a tela agora também avisa na hora, pelo tempo real:
-- cada pessoa recebe só as linhas dela de agenda_event_people (a leitura já é
-- limitada por can_see_agenda_event).
-- =====================================================================

do $$
begin
  begin
    alter publication supabase_realtime add table public.agenda_event_people;
  exception when others then
    null; -- já estava na publicação (ou o banco não tem tempo real)
  end;
end $$;
