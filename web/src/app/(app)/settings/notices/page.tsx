import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DemandNotice } from '../demand-notice';

type Row = Record<string, boolean | string | null>;

/**
 * WhatsApp › Avisos automáticos: todas as mensagens que o sistema manda sozinho, num lugar só — ao
 * cliente no grupo (demanda registrada e concluída, 0091/0092) e à equipe no WhatsApp de cada um
 * (compromissos e demandas, 0106).
 */
export default async function NoticesPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const { data } = await (await createClient()).from('app_settings').select('*').maybeSingle();
  const s = (data ?? {}) as Row;
  const heading = 'px-1 pt-2 text-sm font-semibold text-ink';
  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <h2 className={heading}>Ao cliente, no grupo</h2>
      <DemandNotice enabled={(s.demand_notify_client as boolean | null) ?? true} template={(s.demand_notify_template as string) ?? null} disabled={!isAdmin} />
      <DemandNotice kind="done" enabled={(s.demand_done_notify as boolean | null) ?? true} template={(s.demand_done_template as string) ?? null} disabled={!isAdmin} />
      <h2 className={heading}>À equipe, no WhatsApp de cada um</h2>
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
        Saem pelo WhatsApp conectado da empresa para o número de cada pessoa, cadastrado em <b>Pessoas</b> (ou em Meu perfil).
        Quem não tem telefone não recebe; quem fez a ação não recebe o próprio aviso.
      </p>
      <DemandNotice kind="agenda_new" enabled={Boolean(s.agenda_whats_new)} template={(s.agenda_whats_new_template as string) ?? null} disabled={!isAdmin} />
      <DemandNotice kind="agenda_reminder" enabled={Boolean(s.agenda_whats_reminder)} template={(s.agenda_whats_reminder_template as string) ?? null} disabled={!isAdmin} />
      <DemandNotice kind="demand_assignee" enabled={Boolean(s.demand_whats_assignee)} template={(s.demand_whats_assignee_template as string) ?? null} disabled={!isAdmin} />
    </div>
  );
}
