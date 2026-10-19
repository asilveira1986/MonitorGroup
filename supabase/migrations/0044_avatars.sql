-- =====================================================================
-- Fotos de perfil: participantes dos grupos e imagem do grupo.
--
-- O worker pede ao WhatsApp a foto (tamanho pequeno) de cada grupo e de
-- cada participante, aos poucos, e guarda no bucket privado "media"
-- (pasta <empresa>/avatars). Uma foto por contato da empresa: quem está em
-- vários grupos é baixado uma vez. Atualiza a cada 7 dias ou quando o
-- WhatsApp avisa que a foto mudou. Sem foto (ou escondida pela
-- privacidade do contato) fica registrado também, para não pedir de novo.
-- Configurações › Geral › Imagens e áudios: liga/desliga.
-- =====================================================================

alter table public.app_settings
  add column if not exists avatars_enabled boolean not null default true;

create table if not exists public.contact_avatars (
  company_id uuid not null default public.default_company_id() references public.companies(id) on delete cascade,
  jid        text not null,            -- contato (@s.whatsapp.net / @lid) ou grupo (@g.us)
  path       text,                     -- caminho no bucket "media"; null = sem foto
  checked_at timestamptz not null default now(),
  primary key (company_id, jid)
);

alter table public.contact_avatars enable row level security;

drop policy if exists contact_avatars_read on public.contact_avatars;
create policy contact_avatars_read on public.contact_avatars for select
  using ((select public.is_active_user()) and company_id = (select public.current_company_id()));

grant select on public.contact_avatars to authenticated;

-- membros do grupo: mesma lista de antes + se tem foto
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
      p.joined_at,
      exists (select 1 from public.contact_avatars a
              where a.company_id = p.company_id and a.jid = p.jid and a.path is not null) as has_avatar
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
