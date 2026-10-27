import { PageHeader } from '@/components/ui';
import { requireMenu } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SettingsNav, type NavStatus } from './settings-nav';

export default async function SettingsLayout({ children }: LayoutProps<'/settings'>) {
  const profile = await requireMenu('/settings');
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  // o que já foi configurado (✓ no menu) e a situação do WhatsApp
  const count = (table: string) => supabase.from(table).select('*', { count: 'exact', head: true });
  const [{ data: instances }, users, team, sectors, quick, rules] = await Promise.all([
    supabase.from('whatsapp_instances').select('status'),
    count('profiles'),
    count('team_members'),
    count('sectors'),
    count('quick_replies'),
    supabase.from('alert_rules').select('id', { count: 'exact', head: true }).eq('active', true),
  ]);
  const states = (instances ?? []).map((i) => i.status as string);
  const status: NavStatus = {
    whatsappState: states.includes('connected')
      ? 'connected'
      : states.some((s) => s === 'connecting' || s === 'qr')
        ? 'connecting'
        : 'disconnected',
    users: (users.count ?? 0) > 1,
    team: (team.count ?? 0) > 0,
    sectors: (sectors.count ?? 0) > 0,
    quickReplies: (quick.count ?? 0) > 0,
    alertRules: (rules.count ?? 0) > 0,
  };
  return (
    <>
      <PageHeader title="Configurações" description="Organização, canais, atendimento e monitoramento." />
      <SettingsNav isAdmin={isAdmin} platformAdmin={profile.platform_admin} status={status} />
      <div className="mt-5 min-w-0">{children}</div>
    </>
  );
}
