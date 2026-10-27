import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DemandNotice } from '../demand-notice';

type Row = Record<string, boolean | string | null>;

/** Atendimento › Avisos no WhatsApp da equipe (0106): compromissos e demandas. */
export default async function TeamNoticesPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const { data } = await (await createClient())
    .from('app_settings')
    .select('agenda_whats_new, agenda_whats_new_template, agenda_whats_reminder, agenda_whats_reminder_template, demand_whats_assignee, demand_whats_assignee_template')
    .maybeSingle();
  const s = (data ?? {}) as Row;
  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-2">
        Os avisos saem pelo WhatsApp conectado da empresa para o número de cada pessoa: o telefone em <b>Meu perfil</b> ou, sem ele, o
        cadastrado em <b>Atendentes</b>. Quem não tem telefone não recebe. Quem fez a ação não recebe o próprio aviso.
      </p>
      <DemandNotice kind="agenda_new" enabled={Boolean(s.agenda_whats_new)} template={(s.agenda_whats_new_template as string) ?? null} disabled={!isAdmin} />
      <DemandNotice
        kind="agenda_reminder"
        enabled={Boolean(s.agenda_whats_reminder)}
        template={(s.agenda_whats_reminder_template as string) ?? null}
        disabled={!isAdmin}
      />
      <DemandNotice
        kind="demand_assignee"
        enabled={Boolean(s.demand_whats_assignee)}
        template={(s.demand_whats_assignee_template as string) ?? null}
        disabled={!isAdmin}
      />
    </div>
  );
}
