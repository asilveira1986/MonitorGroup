import { redirect } from 'next/navigation';
import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AlertRule } from '@/lib/types';
import { RulesPanel } from './rules';

/** Monitoramento › Regras de alerta: quando um alerta é criado e por onde avisar. */
export default async function AlertRulesPage({ searchParams }: PageProps<'/settings/alerts'>) {
  // links antigos das seções de avisos
  const secao = (await searchParams).secao;
  if (secao === 'tela' || secao === 'voz') redirect('/settings/avisos');
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  const [{ data: rules }, { data: groups }] = await Promise.all([
    supabase.from('alert_rules').select('*').order('created_at'),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
  ]);
  return (
    <>
      {!isAdmin && <AdminNotice />}
      <RulesPanel rules={(rules ?? []) as AlertRule[]} groups={groups ?? []} isAdmin={isAdmin} />
    </>
  );
}
