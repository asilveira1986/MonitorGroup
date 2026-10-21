-- =====================================================================
-- Mais de um responsável por grupo e avisos dos responsáveis.
--
--  * groups.responsible_member_ids: as pessoas da equipe responsáveis pelo
--    grupo (várias). responsible_member_id continua sendo o primeiro da
--    lista (demandas sem responsável nascem com ele).
--  * team_members.alerts_own_groups_only: a pessoa recebe os avisos só dos
--    grupos em que é responsável — no aviso em tela (usuário com o e-mail de
--    acesso dela) e no WhatsApp/e-mail das regras de alerta. Alertas sem
--    grupo (ex.: WhatsApp desconectado) continuam chegando.
--  * alert_rules.notify_responsibles: a regra também avisa os responsáveis
--    do grupo (WhatsApp no telefone e e-mail de acesso de cada um).
-- =====================================================================

alter table public.groups
  add column if not exists responsible_member_ids uuid[] not null default '{}';

update public.groups
   set responsible_member_ids = array[responsible_member_id]
 where responsible_member_id is not null and responsible_member_ids = '{}';

create index if not exists groups_responsibles_idx on public.groups using gin (responsible_member_ids);

alter table public.team_members
  add column if not exists alerts_own_groups_only boolean not null default false;

alter table public.alert_rules
  add column if not exists notify_responsibles boolean not null default false;

-- lista sem repetidos, só da equipe da empresa; o primeiro vira o responsible_member_id
create or replace function public.sync_group_responsibles()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.responsible_member_ids is not distinct from old.responsible_member_ids
     and new.responsible_member_id is distinct from old.responsible_member_id then
    -- mudou só o campo antigo (um responsável): vira a lista
    new.responsible_member_ids := case when new.responsible_member_id is null then '{}' else array[new.responsible_member_id] end;
  end if;
  new.responsible_member_ids := coalesce(array(
    select x from (select distinct on (x) x, o from unnest(new.responsible_member_ids) with ordinality u(x, o)
                    where x is not null order by x, o) d order by o), '{}');
  if exists (select 1 from unnest(new.responsible_member_ids) x
             where not exists (select 1 from public.team_members t where t.id = x and t.company_id = new.company_id)) then
    raise exception 'O responsável precisa ser uma pessoa da equipe desta empresa.';
  end if;
  new.responsible_member_id := new.responsible_member_ids[1];
  return new;
end;
$$;

drop trigger if exists groups_sync_responsibles on public.groups;
create trigger groups_sync_responsibles before insert or update of responsible_member_id, responsible_member_ids on public.groups
  for each row execute function public.sync_group_responsibles();

-- pessoa removida da equipe sai da lista dos grupos
create or replace function public.team_member_drop_responsible()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  update public.groups set responsible_member_ids = array_remove(responsible_member_ids, old.id)
   where old.id = any(responsible_member_ids);
  return old;
end;
$$;

drop trigger if exists team_members_drop_responsible on public.team_members;
create trigger team_members_drop_responsible before delete on public.team_members
  for each row execute function public.team_member_drop_responsible();

-- aviso em tela: grupos de quem recebe só os seus (null = todos os grupos)
create or replace function public.my_alert_groups()
returns uuid[]
language sql stable security definer set search_path = public
as $$
  select case when exists (
           select 1 from public.team_members t join public.profiles p on lower(p.email) = lower(t.user_email)
            where p.id = auth.uid() and t.company_id = public.current_company_id() and t.alerts_own_groups_only)
    then coalesce((
      select array_agg(distinct g.id) from public.groups g
        join public.team_members t on t.id = any(g.responsible_member_ids)
        join public.profiles p on lower(p.email) = lower(t.user_email)
       where p.id = auth.uid() and g.company_id = public.current_company_id()), '{}')
    else null end
$$;
revoke all on function public.my_alert_groups() from public, anon;
grant execute on function public.my_alert_groups() to authenticated;

-- log: "Definiu os responsáveis do grupo X: Ana, Bruno"
create or replace function public.activity_trigger()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_new     jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_old     jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_changed text[];
  v_cat     text;
  v_action  text := case tg_op when 'INSERT' then 'criou' when 'UPDATE' then 'alterou' else 'excluiu' end;
  v_summary text;
  v_who     record;
  v_group   text;
  v_label   text;
begin
  -- só ações de usuários logados (o worker e a chave de serviço não entram)
  if v_uid is null or current_setting('app.activity_skip', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from jsonb_object_keys(v_new) k
    where k <> all (public.activity_noise()) and (v_new -> k) is distinct from (v_old -> k);
    if v_changed is null then
      return new;
    end if;
  end if;

  if v_row ? 'group_id' then
    select name into v_group from public.groups where id = (v_row->>'group_id')::uuid;
  end if;
  v_label := coalesce(v_row->>'name', v_row->>'title', v_row->>'email', v_row->>'shortcut', v_row->>'day');

  case tg_table_name
    when 'app_settings' then
      v_cat := 'configuracoes';
      v_summary := 'Alterou as configurações: ' || array_to_string(v_changed, ', ');
    when 'groups' then
      v_cat := 'grupos';
      v_summary := case
        when 'monitored' = any(v_changed) then
          case when (v_new->>'monitored')::boolean then 'Passou a monitorar o grupo ' else 'Deixou de monitorar o grupo ' end || v_label
        when 'responsible_member_ids' = any(v_changed) then
          'Definiu os responsáveis do grupo ' || v_label || ': '
          || coalesce((select string_agg(t.name, ', ' order by t.name) from public.team_members t
                        where t.id in (select jsonb_array_elements_text(v_new->'responsible_member_ids')::uuid)), 'sem responsável')
        when 'sector_id' = any(v_changed) then
          'Mudou o setor do grupo ' || v_label || ' para '
          || coalesce((select name from public.sectors where id = (v_new->>'sector_id')::uuid), 'sem setor')
        when 'sla_minutes' = any(v_changed) then
          'Mudou o SLA do grupo ' || v_label || ' para ' || coalesce((v_new->>'sla_minutes') || ' min', 'o padrão')
        when 'pending_since' = any(v_changed) and v_new->>'pending_since' is null then
          'Marcou como respondido o grupo ' || v_label
        else 'Alterou o grupo ' || v_label || ': ' || array_to_string(v_changed, ', ')
      end;
      if v_summary is null then
        return coalesce(new, old);
      end if;
    when 'profiles' then
      v_cat := 'usuarios';
      v_summary := case
        when 'company_id' = any(coalesce(v_changed, '{}')) then 'Entrou na empresa '
          || coalesce((select name from public.companies where id = (v_new->>'company_id')::uuid), '?')
        when tg_op = 'UPDATE' then 'Alterou o usuário ' || coalesce(v_row->>'email', '') || ': '
          || array_to_string(array(select c || ' = ' || coalesce(v_new->>c, '—') from unnest(v_changed) c), ', ')
        else initcap(v_action) || ' o usuário ' || coalesce(v_row->>'email', '')
      end;
    when 'allowed_emails' then
      v_cat := 'usuarios';
      v_summary := case tg_op
        when 'INSERT' then 'Liberou o acesso de ' || (v_row->>'email') || ' (' || coalesce(v_row->>'role', 'agent') || ')'
        when 'DELETE' then 'Removeu o acesso de ' || (v_row->>'email')
        else 'Alterou o acesso de ' || (v_row->>'email') || ': ' || array_to_string(v_changed, ', ') end;
    when 'team_members' then
      v_cat := 'equipe';
      v_summary := case
        when tg_op = 'UPDATE' and 'user_email' = any(v_changed) then 'Deu acesso ao sistema para ' || v_label || ' (' || (v_new->>'user_email') || ')'
        when tg_op = 'INSERT' then 'Adicionou à equipe: ' || v_label
        when tg_op = 'DELETE' then 'Removeu da equipe: ' || v_label
        else 'Alterou na equipe: ' || v_label || ' (' || array_to_string(v_changed, ', ') || ')' end;
    when 'outgoing_messages' then
      if tg_op <> 'INSERT' then
        return coalesce(new, old);
      end if;
      v_cat := 'atendimento';
      v_action := 'respondeu';
      v_summary := 'Respondeu pelo sistema no grupo ' || coalesce(v_group, '?') || ': "' || left(coalesce(v_row->>'body', ''), 120) || '"'
                   || case when coalesce((v_row->>'closes_conversation')::boolean, false) then ' (encerrou a conversa)' else '' end;
    when 'demands' then
      v_cat := 'demandas';
      v_summary := case tg_op
        when 'INSERT' then 'Criou a demanda "' || left(coalesce(v_row->>'description', ''), 100) || '" no grupo ' || coalesce(v_group, '?')
        when 'DELETE' then 'Excluiu a demanda #' || coalesce(v_row->>'number', '?')
        else 'Alterou a demanda #' || coalesce(v_row->>'number', '?') || ': '
          || array_to_string(array(select c || ' = ' || coalesce(v_new->>c, '—') from unnest(v_changed) c
                                   where c in ('status', 'promised_at', 'type', 'description', 'confirmed')), ', ')
          || case when 'assignee_id' = any(v_changed) then ' responsável = '
               || coalesce((select name from public.team_members where id = (v_new->>'assignee_id')::uuid), '—') else '' end
      end;
    when 'alerts' then
      if tg_op <> 'UPDATE' or not ('status' = any(v_changed)) then
        return coalesce(new, old);
      end if;
      v_cat := 'alertas';
      v_summary := case v_new->>'status' when 'resolved' then 'Resolveu o alerta ' when 'acknowledged' then 'Reconheceu o alerta '
                   else 'Mudou o alerta ' end || '"' || coalesce(v_row->>'title', '') || '"';
    when 'alert_rules' then
      v_cat := 'configuracoes';
      v_summary := initcap(v_action) || ' a regra de alerta "' || coalesce(v_label, '') || '"'
                   || case when tg_op = 'UPDATE' then ': ' || array_to_string(v_changed, ', ') else '' end;
    when 'quick_replies' then
      v_cat := 'configuracoes';
      v_summary := initcap(v_action) || ' a mensagem rápida \' || coalesce(v_row->>'shortcut', '');
    when 'sectors' then
      v_cat := 'configuracoes';
      v_summary := initcap(v_action) || ' o setor ' || coalesce(v_label, '');
    when 'holidays' then
      v_cat := 'configuracoes';
      v_summary := initcap(v_action) || ' o feriado ' || coalesce(v_row->>'day', '') || coalesce(' (' || (v_row->>'name') || ')', '');
    when 'companies' then
      v_cat := 'empresas';
      v_summary := initcap(v_action) || ' a empresa ' || coalesce(v_label, '')
                   || case when tg_op = 'UPDATE' then ': ' || array_to_string(v_changed, ', ') else '' end;
    else
      v_cat := 'outros';
      v_summary := initcap(v_action) || ' ' || tg_table_name;
  end case;

  select p.email, coalesce(nullif(p.full_name, ''), p.email) as name, p.company_id into v_who
  from public.profiles p where p.id = v_uid;

  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary, details)
  values (
    coalesce((v_row->>'company_id')::uuid, case when tg_table_name = 'companies' then (v_row->>'id')::uuid end, v_who.company_id),
    v_uid, v_who.email, v_who.name, v_cat, v_action, tg_table_name, v_row->>'id', left(v_summary, 500),
    case when tg_op = 'UPDATE'
         then jsonb_build_object('alterado', (select jsonb_object_agg(c, jsonb_build_object('de', v_old->c, 'para', v_new->c)) from unnest(v_changed) c))
         else null end
  );
  return coalesce(new, old);
exception when others then
  -- o log nunca pode impedir a ação do usuário
  return coalesce(new, old);
end;
$$;

notify pgrst, 'reload schema';
