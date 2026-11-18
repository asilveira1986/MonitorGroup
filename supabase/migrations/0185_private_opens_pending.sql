-- =====================================================================
-- Conversas privadas: mensagem do cliente que não pede resposta não conta como pendente.
--
-- private_messages.opens_pending: false para o que não pede resposta da equipe
-- ("bom dia", "ok", "obrigado", 👍, "vou verificar", informes). O worker grava
-- ao receber a mensagem e revisa as de hoje ao iniciar. O Painel de privadas
-- (private_panel) só conta como pendentes as mensagens de hoje com opens_pending.
-- =====================================================================

alter table public.private_messages add column if not exists opens_pending boolean not null default true;

create or replace function public.private_panel()
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_sla int;
  v_tz text;
  v_today timestamptz;
begin
  select coalesce(default_sla_minutes, 30), coalesce(nullif(timezone, ''), 'America/Sao_Paulo') into v_sla, v_tz
    from public.app_settings where company_id = public.current_company_id();
  v_sla := coalesce(v_sla, 30);
  v_tz := coalesce(v_tz, 'America/Sao_Paulo');
  v_today := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  return coalesce((
    select jsonb_agg(row order by
             case row->>'status' when 'late' then 0 when 'waiting' then 1 when 'answered' then 2 else 3 end,
             coalesce(row->>'waiting_since', row->>'last_message_at') nulls last)
      from (
        select jsonb_build_object(
          'id', c.id, 'name', c.name, 'phone', c.phone, 'instance_id', c.instance_id, 'assigned_to', c.assigned_to,
          'tags', c.tags, 'unread_count', c.unread_count, 'last_message_at', c.last_message_at,
          'last_message_preview', c.last_message_preview,
          'waiting_since', w.since, 'waiting_count', w.n,
          'received_today', t.received, 'sent_today', t.sent,
          'sla_seconds', v_sla * 60,
          'status', case
            when w.since is not null and extract(epoch from (now() - w.since)) > v_sla * 60 then 'late'
            when w.since is not null then 'waiting'
            when t.received + t.sent > 0 then 'answered'
            else 'neutral' end
        ) as row
        from public.private_chats c
        left join lateral (
          -- mensagens do cliente DE HOJE depois da última resposta da equipe (o que ficou de dias anteriores não conta como
          -- pendente no painel: desconsidera mensagens anteriores ao dia) e, das de hoje, as que não pedem
          -- resposta (agradecimento, "bom dia", "vou verificar"; opens_pending, 0185)
          select min(m.sent_at) as since, count(*)::int as n
            from public.private_messages m
           where m.chat_id = c.id and not m.from_me and m.deleted_at is null and m.hidden_at is null
             and m.sent_at >= v_today and m.opens_pending
             and m.sent_at > coalesce((select max(x.sent_at) from public.private_messages x where x.chat_id = c.id and x.from_me), '-infinity'::timestamptz)
        ) w on true
        left join lateral (
          select count(*) filter (where not m.from_me)::int as received, count(*) filter (where m.from_me)::int as sent
            from public.private_messages m
           where m.chat_id = c.id and m.sent_at >= v_today and m.deleted_at is null and m.hidden_at is null
        ) t on true
       where c.closed_at is null
         and c.company_id = public.current_company_id()
      ) q
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.private_panel() from public, anon;
grant execute on function public.private_panel() to authenticated;
