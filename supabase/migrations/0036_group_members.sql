-- =====================================================================
-- Membros dos grupos
--
-- O worker grava os participantes de cada grupo (lista do próprio
-- WhatsApp) ao sincronizar e sempre que alguém entra, sai, vira admin…
--  * group_participants: um registro por pessoa no grupo; quem sai fica
--    com left_at (histórico), e volta a ativo se entrar de novo;
--  * group_members(p_group_id): a lista para a tela do grupo, com nome
--    (do WhatsApp, da equipe ou das mensagens), telefone, admin do grupo,
--    se é da equipe, mensagens nos últimos 30 dias e a última mensagem.
-- Cada usuário vê só os membros dos grupos que já vê (mesmas regras).
-- =====================================================================

create table if not exists public.group_participants (
  id         bigint generated always as identity primary key,
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  group_id   uuid not null references public.groups(id) on delete cascade,
  jid        text not null,
  lid        text,
  phone      text,
  name       text,
  role       text not null default 'member' check (role in ('member', 'admin', 'superadmin')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  updated_at timestamptz not null default now(),
  unique (group_id, jid)
);
create index if not exists group_participants_group_idx on public.group_participants (group_id) where left_at is null;
create index if not exists group_participants_company_idx on public.group_participants (company_id);

alter table public.group_participants enable row level security;
drop policy if exists group_participants_read on public.group_participants;
create policy group_participants_read on public.group_participants for select
  using (group_id in (select unnest(public.visible_group_ids())));

drop trigger if exists group_participants_fill_company on public.group_participants;
create trigger group_participants_fill_company before insert on public.group_participants
  for each row execute function public.fill_company_id();

-- lista da tela do grupo
create or replace function public.group_members(p_group_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  with p as (
    select gp.*
    from public.group_participants gp
    where gp.group_id = p_group_id and gp.left_at is null
  ),
  m as (
    -- mensagens dos últimos 30 dias de cada remetente do grupo
    select msg.sender_jid, msg.sender_phone, count(*) as n, max(msg.sent_at) as last_at,
           (array_agg(msg.sender_name order by msg.sent_at desc) filter (where msg.sender_name is not null))[1] as last_name
    from public.messages msg
    where msg.group_id = p_group_id and msg.sent_at > now() - interval '30 days' and not msg.from_me
    group by msg.sender_jid, msg.sender_phone
  )
  select coalesce(jsonb_agg(row_to_json(x) order by x.is_me desc, x.team desc, x.role_rank, x.last_message_at desc nulls last, x.name), '[]'::jsonb)
  from (
    select
      p.jid,
      p.phone,
      coalesce(tm.name, nullif(p.name, ''), mm.last_name, (
        select msg.sender_name from public.messages msg
        where msg.group_id = p_group_id and msg.sender_name is not null
          and (msg.sender_jid in (p.jid, p.lid) or (p.phone is not null and msg.sender_phone = p.phone))
        order by msg.sent_at desc limit 1)) as name,
      p.role,
      case p.role when 'superadmin' then 0 when 'admin' then 1 else 2 end as role_rank,
      tm.id is not null as team,
      coalesce(p.phone = (select regexp_replace(coalesce(w.phone, ''), '\D', '', 'g')
                          from public.whatsapp_instances w join public.groups g on g.instance_id = w.id
                          where g.id = p_group_id), false) as is_me,
      coalesce(mm.n, 0) as messages_30d,
      mm.last_at as last_message_at,
      p.joined_at
    from p
    left join lateral (
      select t.id, t.name from public.team_members t
      where t.company_id = p.company_id and t.active
        and (t.jid in (p.jid, p.lid) or (p.phone is not null and t.phone = p.phone))
      limit 1
    ) tm on true
    left join lateral (
      select sum(m.n)::int as n, max(m.last_at) as last_at, max(m.last_name) as last_name
      from m where m.sender_jid in (p.jid, p.lid) or (p.phone is not null and m.sender_phone = p.phone)
    ) mm on true
  ) x
  where public.can_view_group(p_group_id)
$$;
grant execute on function public.group_members(uuid) to authenticated;

notify pgrst, 'reload schema';
