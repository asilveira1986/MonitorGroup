import { redirect } from 'next/navigation';
import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AlertRule } from '@/lib/types';
import { AfterHoursGroup } from './after-hours-group';
import { RulesPanel } from './rules';

/** Monitoramento › Regras de alerta: quando um alerta é criado e por onde avisar. */
export default async function AlertRulesPage({ searchParams }: PageProps<'/settings/alerts'>) {
  // links antigos das seções de avisos
  const secao = (await searchParams).secao;
  if (secao === 'tela' || secao === 'voz') redirect('/settings/avisos');
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  const [{ data: rules }, { data: groups }, { data: allGroups }, { data: settings }] = await Promise.all([
    supabase.from('alert_rules').select('*').order('created_at'),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
    // o grupo de alertas fora do expediente pode ser um grupo sem monitoramento (0139)
    supabase.from('groups').select('id, name').is('removed_at', null).order('name'),
    // sem o script do banco (0139) a coluna não existe: segue sem o grupo escolhido
    supabase.from('app_settings').select('*').maybeSingle(),
  ]);
  const afterHoursSettings = (settings ?? {}) as { after_hours_alert_group_id?: string | null; after_hours_alert_minutes?: number | null };
  const afterHours = afterHoursSettings.after_hours_alert_group_id ?? null;
  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <AfterHoursGroup groups={allGroups ?? []} current={afterHours} currentMinutes={afterHoursSettings.after_hours_alert_minutes ?? null} isAdmin={isAdmin} />
      <RulesPanel rules={(rules ?? []) as AlertRule[]} groups={groups ?? []} isAdmin={isAdmin} />
    </div>
  );
}
