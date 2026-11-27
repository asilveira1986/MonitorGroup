-- =====================================================================
-- Alerta em tela quando uma mensagem privada do painel não é entregue (o WhatsApp recusou mesmo depois dos reenvios
-- automáticos do worker).
--
--  * alerts.private_chat_id: a conversa privada do alerta (o alerta abre a conversa).
--  * alerts.user_ids: quem recebe o alerta (quem escreveu a mensagem e o responsável pela conversa). Alerta com destinatários
--    só aparece para eles (na tela de Alertas e no aviso em tela); nem os outros usuários da empresa o veem.
--  * as políticas de leitura/atualização dos alertas passam a respeitar user_ids; sem user_ids valem as regras de antes
--    (alertas de grupo pelos grupos que a pessoa vê, e alertas sem grupo para todos da empresa).
-- =====================================================================

alter table public.alerts add column if not exists private_chat_id uuid references public.private_chats(id) on delete cascade;
alter table public.alerts add column if not exists user_ids uuid[];
create index if not exists alerts_private_chat_idx on public.alerts (private_chat_id) where private_chat_id is not null;

drop policy if exists alerts_read on public.alerts;
create policy alerts_read on public.alerts for select
  using (
    case
      when user_ids is not null then (select auth.uid()) = any (user_ids)
      else group_id in (select unnest(public.visible_group_ids()))
           or (group_id is null and (select public.is_active_user()) and company_id = (select public.current_company_id()))
    end
  );

drop policy if exists alerts_update on public.alerts;
create policy alerts_update on public.alerts for update
  using (
    case
      when user_ids is not null then (select auth.uid()) = any (user_ids)
      else group_id in (select unnest(public.visible_group_ids()))
           or (group_id is null and (select public.is_active_user()) and company_id = (select public.current_company_id()))
    end
  )
  with check (
    case
      when user_ids is not null then (select auth.uid()) = any (user_ids)
      else group_id in (select unnest(public.visible_group_ids()))
           or (group_id is null and (select public.is_active_user()) and company_id = (select public.current_company_id()))
    end
  );

notify pgrst, 'reload schema';
