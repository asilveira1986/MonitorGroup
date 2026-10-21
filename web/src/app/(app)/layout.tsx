import { LogOut } from 'lucide-react';
import { CompanySwitcher } from '@/components/company-switcher';
import { MessageNotifier, MyAlertsToggle, NotifyToggle } from '@/components/message-notifier';
import { RealtimeListener } from '@/components/realtime-listener';
import { Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { currentCompany, requireProfile } from '@/lib/auth';
import { demandsEnabled } from '@/lib/format';
import { canSeeMenu, MENU_ITEMS } from '@/lib/menu';
import { ROLE_LABEL } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ count: pending }, { count: alerts }, { count: demands }, { data: settings }, company, { data: companies }, { data: due }] = await Promise.all([
    supabase.from('pending_queue').select('id', { count: 'exact', head: true }),
    supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).in('status', ['aberta', 'em_andamento']),
    supabase
      .from('app_settings')
      .select(
        'demand_manual_enabled, demand_command_enabled, demand_keyword_enabled, demand_ai_enabled, demand_commitment_enabled, msg_alert_enabled, msg_alert_auto_close, msg_alert_sound, msg_alert_alerts, msg_alert_voice, msg_alert_voice_messages, msg_alert_voice_sla, msg_alert_voice_templates, msg_alert_voice_name, msg_alert_voice_rate, msg_alert_voice_pitch, menu_access',
      )
      .maybeSingle(),
    currentCompany(),
    // quem administra a plataforma troca de empresa pelo topo
    profile.platform_admin
      ? supabase.from('companies').select('id, name, active').order('name')
      : Promise.resolve({ data: null }),
    // agenda: demandas do usuário para entregar hoje e atrasadas (sem o script 0059, nada)
    supabase.rpc('my_due_demands'),
  ]);
  const dueToday = Number((due as { hoje?: number } | null)?.hoje ?? 0);
  const dueLate = Number((due as { atrasadas?: number } | null)?.atrasadas ?? 0);
  const dueEvents = Number((due as { compromissos?: number } | null)?.compromissos ?? 0);

  const initials = (profile.full_name || profile.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

  return (
    <div className="min-h-screen">
      <Sidebar
        counts={{ pending: pending ?? 0, alerts: alerts ?? 0, demands: demands ?? 0, agenda: dueToday + dueLate + dueEvents }}
        // demandas desligadas nas configurações: o item some do menu
        // + os menus que a empresa ocultou para este usuário (Configurações › Menus)
        hidden={[
          ...(demandsEnabled(settings) ? [] : ['/demands', '/agenda']),
          ...MENU_ITEMS.filter(
            (i) =>
              !canSeeMenu(
                settings?.menu_access as Record<string, unknown> | null,
                i.href,
                profile.role === 'admin' || profile.platform_admin,
                profile.role === 'viewer',
              ),
          ).map((i) => i.href),
        ]}
        user={{ name: profile.full_name || profile.email.split('@')[0], role: profile.role }}
        platformAdmin={profile.platform_admin}
        alertsOff={profile.platform_admin ? Boolean(profile.alerts_off) : undefined}
        company={company?.name ?? null}
      />
      <RealtimeListener />
      <MessageNotifier
        config={{
          enabled: settings?.msg_alert_enabled ?? true,
          alerts: settings?.msg_alert_alerts ?? true,
          autoClose: settings?.msg_alert_auto_close ?? 0,
          sound: settings?.msg_alert_sound ?? true,
          voice: settings?.msg_alert_voice ?? true,
          voiceMessages: settings?.msg_alert_voice_messages ?? true,
          voiceSla: settings?.msg_alert_voice_sla ?? true,
          voiceOptions: {
            templates: settings?.msg_alert_voice_templates as Record<string, string> | null,
            voiceName: settings?.msg_alert_voice_name,
            rate: settings?.msg_alert_voice_rate,
            pitch: settings?.msg_alert_voice_pitch,
          },
          userOff: Boolean(profile.alerts_off),
        }}
      />
      <div className="transition-[padding] duration-200 lg:pl-64 lg:[[data-sidebar=collapsed]_&]:pl-[4.5rem]">
        <header className="brand-hairline sticky top-0 z-20 hidden items-center justify-end gap-2 bg-surface/70 px-8 py-3 backdrop-blur-md lg:flex">
          {company && (
            <div className="mr-auto">
              <CompanySwitcher current={company} companies={companies ?? undefined} />
            </div>
          )}
          {profile.platform_admin && <MyAlertsToggle off={Boolean(profile.alerts_off)} />}
          <NotifyToggle />
          <ThemeToggle />
          <div className="ml-2 flex items-center gap-3 rounded-xl px-2 py-1">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-brand to-[#8fc41a] text-xs font-bold text-brand-ink shadow-[0_4px_12px_-4px_rgba(150,200,20,0.8)]">
                {initials}
              </div>
            )}
            <div className="leading-tight">
              <p className="text-sm font-medium">{profile.full_name || profile.email.split('@')[0]}</p>
              <p className="text-[11px] text-muted">{ROLE_LABEL[profile.role]}</p>
            </div>
          </div>
          <form action="/auth/signout" method="post">
            <button className="rounded-xl p-2 text-ink-2 hover:bg-surface-2 hover:text-ink" title="Sair" aria-label="Sair">
              <LogOut className="h-5 w-5" />
            </button>
          </form>
        </header>
        <main className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-8 sm:py-8 has-[[data-wide]]:max-w-none">{children}</main>
      </div>
    </div>
  );
}
