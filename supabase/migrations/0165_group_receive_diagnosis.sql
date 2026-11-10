-- =====================================================================
-- Grupo que "parou de receber": diagnóstico e mensagens que não puderam
-- ser abertas.
--
--  * groups.undecrypted_count / last_undecrypted_at / last_undecrypted_reason:
--    o worker conta as mensagens do grupo que chegaram pelo WhatsApp mas não
--    puderam ser abertas (chave do grupo/sessão) e desconta as que chegam
--    depois pelo reenvio automático. O que sobra na conta foi perdido.
--  * group_receive_diagnosis(grupo), só administradores: o número que
--    monitora o grupo (situação, último sinal, quando recebeu a última
--    mensagem de QUALQUER grupo), as outras cópias do grupo em outros números
--    e a conta acima. Responde "o número parou?" ou "só este grupo?".
--  * O worker também pede sozinho a recuperação do intervalo quando chega
--    uma mensagem num grupo que ficou 24 h ou mais sem nada guardado
--    (history_requests sem requested_by = pedido automático).
-- =====================================================================

alter table public.groups
  add column if not exists undecrypted_count int not null default 0,
  add column if not exists last_undecrypted_at timestamptz,
  add column if not exists last_undecrypted_reason text;

-- só o worker (chave de serviço)
create or replace function public.note_undecrypted_message(p_group_id uuid, p_delta int, p_reason text default null)
returns void language sql security definer set search_path = public as $$
  update public.groups
     set undecrypted_count = greatest(0, undecrypted_count + p_delta),
         last_undecrypted_at = case when p_delta > 0 then now() else last_undecrypted_at end,
         last_undecrypted_reason = case when p_delta > 0 then coalesce(left(p_reason, 200), last_undecrypted_reason) else last_undecrypted_reason end
   where id = p_group_id
$$;
revoke all on function public.note_undecrypted_message(uuid, int, text) from public, anon, authenticated;
grant execute on function public.note_undecrypted_message(uuid, int, text) to service_role;

create or replace function public.group_receive_diagnosis(p_group_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  g public.groups%rowtype;
  v jsonb;
begin
  if not public.is_admin() then
    raise exception 'Só administradores veem o diagnóstico.' using errcode = '42501';
  end if;
  select * into g from public.groups where id = p_group_id and company_id = public.current_company_id();
  if not found then
    raise exception 'Grupo não encontrado.' using errcode = 'P0002';
  end if;
  select jsonb_build_object(
    'group', jsonb_build_object(
      'last_message_at', g.last_message_at,
      'monitored', g.monitored,
      'removed_at', g.removed_at,
      'undecrypted_count', g.undecrypted_count,
      'last_undecrypted_at', g.last_undecrypted_at,
      'last_undecrypted_reason', g.last_undecrypted_reason),
    'instance', (
      select jsonb_build_object(
        'name', i.name, 'phone', i.phone, 'status', i.status, 'last_seen_at', i.last_seen_at,
        'connected_at', i.connected_at, 'last_error', i.last_error,
        'last_message_at', (select max(x.last_message_at) from public.groups x where x.instance_id = i.id and x.removed_at is null),
        'groups_active_24h', (select count(*) from public.groups x where x.instance_id = i.id and x.removed_at is null
                                and x.last_message_at > now() - interval '24 hours'))
        from public.whatsapp_instances i where i.id = g.instance_id),
    'copies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', i.name, 'phone', i.phone, 'status', i.status,
               'monitored', c.monitored, 'removed_at', c.removed_at, 'last_message_at', c.last_message_at)
             order by c.last_message_at desc nulls last)
        from public.groups c join public.whatsapp_instances i on i.id = c.instance_id
       where c.jid = g.jid and c.company_id = g.company_id and c.id <> g.id), '[]'::jsonb),
    'auto_request', (
      select jsonb_build_object('status', r.status, 'created_at', r.created_at, 'messages_added', r.messages_added, 'note', r.note)
        from public.history_requests r
       where r.group_id = g.id and r.requested_by is null and r.batch_id is null
       order by r.created_at desc limit 1)
  ) into v;
  return v;
end;
$$;
revoke all on function public.group_receive_diagnosis(uuid) from public, anon;
grant execute on function public.group_receive_diagnosis(uuid) to authenticated;
