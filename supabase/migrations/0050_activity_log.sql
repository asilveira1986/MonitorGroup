-- =====================================================================
-- Log de atividades (aba "Log", só para quem administra a plataforma).
--
-- Registra o que os USUÁRIOS fazem pelo painel (o que o worker faz sozinho
-- não entra): configurações, usuários e equipe, grupos (monitorar, setor,
-- responsável, SLA, marcar como respondida), respostas enviadas, demandas,
-- alertas tratados, regras, mensagens rápidas, setores, feriados e empresas.
-- Os logins e logouts vêm do próprio registro do Supabase Auth.
-- Os registros com mais de 180 dias são apagados automaticamente.
-- =====================================================================

create table if not exists public.activity_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  company_id uuid references public.companies(id) on delete cascade,
  user_id    uuid,
  user_email text,
  user_name  text,
  category   text not null,   -- configuracoes | usuarios | equipe | grupos | atendimento | demandas | alertas | empresas
  action     text not null,   -- criou | alterou | excluiu | respondeu ...
  entity     text not null,   -- tabela
  entity_id  text,
  summary    text not null,
  details    jsonb
);

create index if not exists activity_log_created_idx on public.activity_log (created_at desc);
create index if not exists activity_log_company_idx on public.activity_log (company_id, created_at desc);

alter table public.activity_log enable row level security;
drop policy if exists activity_log_platform on public.activity_log;
create policy activity_log_platform on public.activity_log for select using ((select public.is_platform_admin()));
-- ninguém grava direto: só os gatilhos abaixo
revoke insert, update, delete on public.activity_log from anon, authenticated;
grant select on public.activity_log to authenticated;

-- colunas que mudam sozinhas e não interessam no log
create or replace function public.activity_noise()
returns text[] language sql immutable as $$
  select array['updated_at', 'created_at', 'last_message_at', 'last_client_message_at', 'last_team_message_at',
               'last_message_preview', 'participants_count', 'pending_count', 'pending_message_id',
               'conversation_started_at', 'closed_at', 'seen_at', 'seen_via', 'seen_by', 'status_changed_at',
               'number', 'id']
$$;

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
        when 'responsible_member_id' = any(v_changed) then
          'Definiu o responsável do grupo ' || v_label || ': '
          || coalesce((select name from public.team_members where id = (v_new->>'responsible_member_id')::uuid), 'sem responsável')
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

do $$
declare t text;
begin
  foreach t in array array['app_settings', 'groups', 'profiles', 'allowed_emails', 'team_members', 'outgoing_messages',
                           'demands', 'alerts', 'alert_rules', 'quick_replies', 'sectors', 'holidays', 'companies'] loop
    execute format('drop trigger if exists zz_activity_log on public.%I', t);
    execute format('create trigger zz_activity_log after insert or update or delete on public.%I
                    for each row execute function public.activity_trigger()', t);
  end loop;
end $$;

-- "Recalcular grupos": uma linha no log, não uma por grupo recalculado
create or replace function public.recalc_groups()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_res jsonb;
begin
  if not public.is_admin() then
    raise exception 'Somente administradores recalculam os grupos.';
  end if;
  perform set_config('app.activity_skip', 'on', true);
  v_res := public.recalc_company_groups(public.current_company_id());
  perform set_config('app.activity_skip', 'off', true);
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, summary, details)
  select p.company_id, p.id, p.email, coalesce(nullif(p.full_name, ''), p.email), 'equipe', 'recalculou', 'groups',
         'Recalculou os grupos (aguardando: ' || coalesce(v_res->>'aguardando_antes', '?') || ' → '
         || coalesce(v_res->>'aguardando_depois', '?') || ')', v_res
  from public.profiles p where p.id = auth.uid();
  return v_res;
end;
$$;
revoke all on function public.recalc_groups() from public, anon;
grant execute on function public.recalc_groups() to authenticated;

-- Log para a tela: atividades + logins/logouts do Supabase Auth (só quem administra a plataforma)
create or replace function public.platform_activity_log(
  p_from timestamptz, p_to timestamptz, p_company_id uuid default null, p_user text default null,
  p_category text default null, p_limit int default 100, p_offset int default 0
)
returns table (
  created_at timestamptz, company_id uuid, company_name text, user_email text, user_name text,
  category text, action text, summary text, details jsonb
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Somente quem administra a plataforma vê o log.' using errcode = '42501';
  end if;
  return query
  with acts as (
    select a.created_at, a.company_id, a.user_email, a.user_name, a.category, a.action, a.summary, a.details
    from public.activity_log a
    where a.created_at >= p_from and a.created_at < p_to
  ),
  logins as (
    select e.created_at, p.company_id, coalesce(p.email, e.payload->>'actor_username') as user_email,
           coalesce(nullif(p.full_name, ''), e.payload->>'actor_name', e.payload->>'actor_username') as user_name,
           'acesso'::text as category,
           (e.payload->>'action')::text as action,
           (case e.payload->>'action'
              when 'login' then 'Entrou no sistema'
              when 'logout' then 'Saiu do sistema'
              when 'user_recovery_requested' then 'Pediu para redefinir a senha'
              when 'user_updated_password' then 'Trocou a senha'
              else 'Acesso: ' || (e.payload->>'action') end)
           || case when coalesce(e.ip_address, '') <> '' then ' (IP ' || e.ip_address || ')' else '' end as summary,
           null::jsonb as details
    from auth.audit_log_entries e
    left join public.profiles p on p.id::text = e.payload->>'actor_id'
    where e.created_at >= p_from and e.created_at < p_to
      and e.payload->>'action' in ('login', 'logout', 'user_recovery_requested', 'user_updated_password')
  )
  select x.created_at, x.company_id, c.name, x.user_email, x.user_name, x.category, x.action, x.summary, x.details
  from (select * from acts union all select * from logins) x
  left join public.companies c on c.id = x.company_id
  where (p_company_id is null or x.company_id = p_company_id)
    and (p_category is null or x.category = p_category)
    and (p_user is null or x.user_email ilike '%' || p_user || '%' or x.user_name ilike '%' || p_user || '%')
  order by x.created_at desc
  limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0);
end;
$$;

revoke all on function public.platform_activity_log(timestamptz, timestamptz, uuid, text, text, int, int) from public, anon;
grant execute on function public.platform_activity_log(timestamptz, timestamptz, uuid, text, text, int, int) to authenticated;

-- retenção: apaga registros com mais de 180 dias (chamado pela tela do log)
create or replace function public.purge_activity_log()
returns int language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_platform_admin() then
    return 0;
  end if;
  delete from public.activity_log where created_at < now() - interval '180 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.purge_activity_log() from public, anon;
grant execute on function public.purge_activity_log() to authenticated;
