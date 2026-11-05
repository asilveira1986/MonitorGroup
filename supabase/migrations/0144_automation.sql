-- =====================================================================
-- Automação de atendimento: acuse + alerta + aviso + cobrança.
--
-- Quando um cliente escreve num grupo com a automação ligada, o worker:
--   1. responde no próprio grupo (acuse de recebimento, citando a mensagem);
--   2. cria o alerta em tela (alerts, tipo new_message);
--   3. avisa o grupo interno (por exemplo, o grupo "Trabalhista");
--   4. abre uma demanda (automation_pending) e a cobra no grupo interno enquanto ninguém responder.
-- Uma mensagem da equipe (ou do número conectado) no grupo encerra a demanda.
--
--  * automation_rules:   uma regra por grupo (textos, tempos, horário de atendimento, grupo interno).
--  * automation_pending: demandas abertas e encerradas; guarda as cobranças já feitas, então um
--                        reinício do worker não perde nada. Uma só demanda aberta por grupo.
--  * automation_log:     o que a automação fez (acuse, aviso, cobrança, encerramento).
--  * Os alertas em tela usam a tabela alerts (tipos new_message e no_reply), sem mudar o que existe.
-- =====================================================================

create table if not exists public.automation_rules (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  group_id           uuid not null unique references public.groups(id) on delete cascade,
  enabled            boolean not null default true,
  ack_enabled        boolean not null default true,
  ack_message        text not null default '✅ Recebemos sua mensagem! Nossa equipe já foi avisada e retorna em breve.',
  ack_off_hours      text not null default '✅ Recebemos sua mensagem! Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Retornaremos no próximo horário útil.',
  ack_cooldown_min   int  not null default 30 check (ack_cooldown_min >= 0),
  last_ack_at        timestamptz,
  notify_group_jid   text not null,
  notify_group_name  text not null default 'Trabalhista',
  escalate_after_min int  not null default 15 check (escalate_after_min >= 0),
  repeat_every_min   int  not null default 30 check (repeat_every_min >= 0),
  max_escalations    int  not null default 3 check (max_escalations >= 0),
  escalate_off_hours boolean not null default false,
  mention_jids       text[] not null default '{}',
  business_days      int[] not null default '{1,2,3,4,5}',
  business_start     text not null default '08:00' check (business_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  business_end       text not null default '18:00' check (business_end ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists automation_rules_company_idx on public.automation_rules (company_id);

create table if not exists public.automation_pending (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  group_id          uuid not null references public.groups(id) on delete cascade,
  instance_id       uuid references public.whatsapp_instances(id) on delete set null,
  group_jid         text not null,
  first_message_id  text not null,   -- id da mensagem do cliente no WhatsApp
  client_name       text,
  preview           text not null default '',
  message_count     int  not null default 1,
  received_at       timestamptz not null default now(),
  escalation_count  int  not null default 0,
  last_escalated_at timestamptz,
  alert_id          uuid references public.alerts(id) on delete set null,
  resolved_at       timestamptz,
  resolved_by       text,
  response_sec      int
);
-- uma só demanda aberta por grupo (também protege de duas mensagens chegando juntas)
create unique index if not exists automation_pending_open_idx on public.automation_pending (group_id) where resolved_at is null;
create index if not exists automation_pending_resolved_idx on public.automation_pending (company_id, resolved_at, received_at);
create index if not exists automation_pending_group_jid_idx on public.automation_pending (group_jid, resolved_at);

create table if not exists public.automation_log (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  group_id    uuid not null references public.groups(id) on delete cascade,
  action      text not null check (action in ('ACK', 'ACK_OFFHOURS', 'NOTIFY', 'ESCALATE', 'RESOLVED')),
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists automation_log_group_idx on public.automation_log (group_id, created_at desc);

-- ------------------------------------------------ permissões
alter table public.automation_rules   enable row level security;
alter table public.automation_pending enable row level security;
alter table public.automation_log     enable row level security;

-- regras: todos os usuários ativos da empresa leem; só administradores alteram
drop policy if exists automation_rules_read on public.automation_rules;
create policy automation_rules_read on public.automation_rules for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
drop policy if exists automation_rules_admin on public.automation_rules;
create policy automation_rules_admin on public.automation_rules for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

-- demandas e histórico: leitura dos grupos que a pessoa vê (a escrita é do worker, pela chave de serviço)
drop policy if exists automation_pending_read on public.automation_pending;
create policy automation_pending_read on public.automation_pending for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()) and public.can_view_group(group_id));
drop policy if exists automation_log_read on public.automation_log;
create policy automation_log_read on public.automation_log for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()) and public.can_view_group(group_id));

-- ------------------------------------------------ encerramento manual
create or replace function public.resolve_automation_pending(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v      public.automation_pending%rowtype;
  v_name text;
begin
  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;
  select * into v from public.automation_pending
   where id = p_id and company_id = public.current_company_id() and resolved_at is null;
  if not found then
    raise exception 'Demanda não encontrada ou já encerrada.';
  end if;
  if not public.has_group_permission(v.group_id, 'alerts') then
    raise exception 'Seu setor não tem permissão para tratar alertas deste grupo.' using errcode = '42501';
  end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'usuário') into v_name
    from public.profiles where id = auth.uid();
  update public.automation_pending
     set resolved_at = now(), resolved_by = 'manual: ' || v_name,
         response_sec = greatest(0, extract(epoch from now() - received_at)::int)
   where id = p_id;
  -- os alertas em tela da automação deste grupo saem da tela
  update public.alerts set status = 'resolved', resolved_at = now()
   where group_id = v.group_id and type in ('new_message', 'no_reply') and status <> 'resolved';
  insert into public.automation_log (company_id, group_id, action, detail)
  values (v.company_id, v.group_id, 'RESOLVED', 'encerrada manualmente por ' || v_name);
end;
$$;
revoke all on function public.resolve_automation_pending(uuid) from public, anon;
grant execute on function public.resolve_automation_pending(uuid) to authenticated;

-- ------------------------------------------------ métricas
-- p_days: período em dias (demandas recebidas nele; as abertas contam sempre)
create or replace function public.automation_metrics(p_days int default 30)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'days', p_days,
    'resolved', count(*) filter (where resolved_at is not null and received_at >= now() - make_interval(days => p_days)),
    'open', count(*) filter (where resolved_at is null),
    'avg_response_sec', round(avg(response_sec) filter (where resolved_at is not null and received_at >= now() - make_interval(days => p_days))),
    'median_response_sec', round((percentile_cont(0.5) within group (order by response_sec)
                                  filter (where resolved_at is not null and received_at >= now() - make_interval(days => p_days)))::numeric),
    'escalated', count(*) filter (where escalation_count > 0 and received_at >= now() - make_interval(days => p_days))
  )
  from public.automation_pending
  where company_id = public.current_company_id()
    and (resolved_at is null or received_at >= now() - make_interval(days => p_days))
$$;
revoke all on function public.automation_metrics(int) from public, anon;
grant execute on function public.automation_metrics(int) to authenticated;

notify pgrst, 'reload schema';
