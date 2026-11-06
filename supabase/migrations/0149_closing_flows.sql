-- =====================================================================
-- Regra de mensagem de encerramento: pergunta ao cliente (enquete) e age conforme a resposta.
--
-- Quando a equipe encerra o atendimento num grupo com a regra ligada, o worker espera alguns minutos e envia
-- uma enquete ("Seu atendimento foi resolvido?" com as opções configuradas). O WhatsApp não entrega botões
-- de verdade para números comuns em grupos; a enquete é o "botão" (o cliente também pode digitar 1, 2 ou o
-- texto da opção). Cada opção define o que fazer: responder no grupo, avisar o grupo interno e/ou reabrir.
--
--  * closing_flows:   regras (pergunta, opções, grupos, tempos, grupo interno).
--  * closing_surveys: uma pergunta enviada (ou agendada) a um grupo e a resposta recebida.
-- =====================================================================

create table if not exists public.closing_flows (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  name              text not null default 'Pesquisa de encerramento',
  enabled           boolean not null default true,
  question          text not null default 'Seu atendimento foi resolvido?',
  -- [{ "label": "Sim, resolvido", "reply": "texto enviado ao grupo", "reopen": false, "notify": false }]
  options           jsonb not null default '[]'::jsonb,
  group_ids         uuid[] not null default '{}',
  delay_min         int  not null default 5   check (delay_min >= 0),
  expire_hours      int  not null default 24  check (expire_hours >= 1),
  notify_group_jid  text,
  notify_group_name text,
  mention_jids      text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists closing_flows_company_idx on public.closing_flows (company_id);

create table if not exists public.closing_surveys (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  flow_id       uuid references public.closing_flows(id) on delete set null,
  group_id      uuid not null references public.groups(id) on delete cascade,
  instance_id   uuid references public.whatsapp_instances(id) on delete set null,
  group_jid     text not null,
  status        text not null default 'scheduled' check (status in ('scheduled', 'sent', 'answered', 'expired', 'cancelled')),
  send_at       timestamptz not null,
  sent_at       timestamptz,
  expires_at    timestamptz,
  poll_wa_id    text,
  poll_message  text,          -- mensagem da enquete (BufferJSON): a chave para abrir os votos
  question      text not null default '',
  options       jsonb not null default '[]'::jsonb,
  answer_label  text,
  answer_index  int,
  answered_by   text,
  answered_at   timestamptz,
  created_at    timestamptz not null default now()
);
-- uma só pergunta em andamento por grupo
create unique index if not exists closing_surveys_open_idx on public.closing_surveys (group_id) where status in ('scheduled', 'sent');
create index if not exists closing_surveys_poll_idx on public.closing_surveys (poll_wa_id) where poll_wa_id is not null;
create index if not exists closing_surveys_company_idx on public.closing_surveys (company_id, created_at desc);

alter table public.closing_flows   enable row level security;
alter table public.closing_surveys enable row level security;

drop policy if exists closing_flows_read on public.closing_flows;
create policy closing_flows_read on public.closing_flows for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));
drop policy if exists closing_flows_admin on public.closing_flows;
create policy closing_flows_admin on public.closing_flows for all
  using ((select public.is_admin()) and company_id = (select public.current_company_id()))
  with check ((select public.is_admin()) and company_id = (select public.current_company_id()));

-- respostas: leitura dos grupos que a pessoa vê (a escrita é do worker)
drop policy if exists closing_surveys_read on public.closing_surveys;
create policy closing_surveys_read on public.closing_surveys for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()) and public.can_view_group(group_id));

-- ------------------------------------------------ métricas
create or replace function public.closing_metrics(p_days int default 30)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'days', p_days,
    'sent', count(*) filter (where status in ('sent', 'answered', 'expired')),
    'answered', count(*) filter (where status = 'answered'),
    'waiting', count(*) filter (where status in ('scheduled', 'sent')),
    'expired', count(*) filter (where status = 'expired'),
    'by_answer', coalesce((
      select jsonb_object_agg(a.answer_label, a.n) from (
        select answer_label, count(*) n from public.closing_surveys
         where company_id = public.current_company_id() and status = 'answered'
           and created_at >= now() - make_interval(days => p_days)
         group by answer_label) a), '{}'::jsonb)
  )
  from public.closing_surveys
  where company_id = public.current_company_id()
    and created_at >= now() - make_interval(days => p_days)
$$;
revoke all on function public.closing_metrics(int) from public, anon;
grant execute on function public.closing_metrics(int) to authenticated;

notify pgrst, 'reload schema';
