-- =====================================================================
-- Pendência da conversa por regras (sem IA): com quem ficou a próxima ação.
--
-- O worker lê as últimas mensagens de cada grupo e grava aqui (ver
-- worker/src/followup.ts):
--  * followup_status: 'company' (a empresa deve: pergunta do cliente sem
--    resposta, promessa da equipe sem entrega, documento do cliente a
--    conferir), 'client' (a equipe pediu algo ao cliente) ou 'resolved'.
--  * followup_kind / reason / excerpt / trigger: o porquê, para a tela.
--  * followup_due_at: prazo citado ("até sexta", "em 2 dias").
--  * "Não está pendente" (dismiss_group_followup): a pessoa marca à mão; só
--    as mensagens seguintes voltam a contar.
-- Configurações › Pendências: liga/desliga e frases de pedido ao cliente e
-- de entrega (as promessas usam os gatilhos de compromisso das demandas).
-- =====================================================================

alter table public.groups
  add column if not exists followup_status text check (followup_status in ('company', 'client', 'resolved')),
  add column if not exists followup_kind text,
  add column if not exists followup_reason text,
  add column if not exists followup_excerpt text,
  add column if not exists followup_trigger text,
  add column if not exists followup_message_id uuid,
  add column if not exists followup_since timestamptz,
  add column if not exists followup_due_at timestamptz,
  add column if not exists followup_actor text,
  add column if not exists followup_updated_at timestamptz,
  add column if not exists followup_dismissed_at timestamptz,
  add column if not exists followup_dismissed_by text;
create index if not exists groups_followup_idx on public.groups (company_id, followup_status) where followup_status in ('company', 'client');

alter table public.app_settings
  add column if not exists followup_enabled boolean not null default true,
  add column if not exists followup_request_phrases text[],
  add column if not exists followup_delivery_phrases text[];

-- "Não está pendente": quem pode ver o grupo e escrever (não vale para o perfil "somente ver painéis")
create or replace function public.dismiss_group_followup(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_name text;
begin
  if not public.can_write() then
    raise exception 'Seu perfil é somente para ver os painéis.' using errcode = '42501';
  end if;
  if not (p_group_id = any(public.visible_group_ids())) then
    raise exception 'Grupo não encontrado.' using errcode = 'P0002';
  end if;
  select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1)) into v_name from public.profiles where id = auth.uid();
  -- no log, uma linha clara em vez de "alterou o grupo: followup_..."
  perform set_config('app.activity_skip', 'on', true);
  update public.groups
     set followup_status = 'resolved', followup_kind = 'manual',
         followup_reason = 'Marcado como sem pendência', followup_excerpt = null, followup_trigger = null,
         followup_message_id = null, followup_since = null, followup_due_at = null,
         followup_actor = v_name, followup_updated_at = now(),
         followup_dismissed_at = now(), followup_dismissed_by = v_name
   where id = p_group_id;
  perform set_config('app.activity_skip', 'off', true);
  insert into public.activity_log (company_id, user_id, user_email, user_name, category, action, entity, entity_id, summary)
  select g.company_id, p.id, p.email, v_name, 'atendimento', 'alterou', 'groups', g.id::text,
         'Marcou a conversa do grupo ' || g.name || ' como sem pendência'
    from public.groups g, public.profiles p
   where g.id = p_group_id and p.id = auth.uid();
end;
$$;
revoke all on function public.dismiss_group_followup(uuid) from public, anon;
grant execute on function public.dismiss_group_followup(uuid) to authenticated;

-- regras mudaram (Configurações): o worker recalcula a pendência de todos os grupos da empresa aos poucos
create or replace function public.recompute_followups()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Só administradores alteram as regras de pendência.' using errcode = '42501';
  end if;
  perform set_config('app.activity_skip', 'on', true);
  update public.groups set followup_updated_at = null where company_id = public.current_company_id();
  perform set_config('app.activity_skip', 'off', true);
end;
$$;
revoke all on function public.recompute_followups() from public, anon;
grant execute on function public.recompute_followups() to authenticated;
