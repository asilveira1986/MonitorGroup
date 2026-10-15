import { LogOut } from 'lucide-react';
import { CompanySwitcher } from '@/components/company-switcher';
import { MessageNotifier, NotifyToggle } from '@/components/message-notifier';
import { RealtimeListener } from '@/components/realtime-listener';
import { Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { currentCompany, requireProfile } from '@/lib/auth';
import { demandsEnabled } from '@/lib/format';
import { canSeeMenu, MENU_ITEMS } from '@/lib/menu';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ count: pending }, { count: alerts }, { count: demands }, { data: settings }, company, { data: companies }] = await Promise.all([
    supabase.from('pending_queue').select('id', { count: 'exact', head: true }),
    supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).in('status', ['aberta', 'em_andamento']),
    supabase
      .from('app_settings')
      .select(
        'demand_manual_enabled, demand_command_enabled, demand_keyword_enabled, demand_ai_enabled, demand_commitment_enabled, msg_alert_enabled, msg_alert_auto_close, msg_alert_sound, msg_alert_alerts, msg_alert_voice, msg_alert_voice_messages, msg_alert_voice_sla, menu_access',
      )
      .maybeSingle(),
    currentCompany(),
    // quem administra a plataforma troca de empresa pelo topo
    profile.platform_admin
      ? supabase.from('companies').select('id, name, active').order('name')
      : Promise.resolve({ data: null }),
  ]);

  const initials = (profile.full_name || profile.email)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('');

  return (
    <div className="min-h-screen">
      <Sidebar
        counts={{ pending: pending ?? 0, alerts: alerts ?? 0, demands: demands ?? 0 }}
        // demandas desligadas nas configurações: o item some do menu
        // + os menus que a empresa ocultou para este usuário (Configurações › Menus)
        hidden={[
          ...(demandsEnabled(settings) ? [] : ['/demands']),
          ...MENU_ITEMS.filter(
            (i) => !canSeeMenu(settings?.menu_access as Record<string, unknown> | null, i.href, profile.role === 'admin' || profile.platform_admin),
          ).map((i) => i.href),
        ]}
        user={{ name: profile.full_name || profile.email.split('@')[0], role: profile.role }}
        platformAdmin={profile.platform_admin}
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
        }}
      />
      <div className="transition-[padding] duration-200 lg:pl-64 lg:[[data-sidebar=collapsed]_&]:pl-[4.5rem]">
        <header className="sticky top-0 z-20 hidden items-center justify-end gap-2 border-b border-line bg-bg/80 px-8 py-3 backdrop-blur lg:flex">
          {company && (
            <div className="mr-auto">
              <CompanySwitcher current={company} companies={companies ?? undefined} />
            </div>
          )}
          <NotifyToggle />
          <ThemeToggle />
          <div className="ml-2 flex items-center gap-3 rounded-xl px-2 py-1">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                {initials}
              </div>
            )}
            <div className="leading-tight">
              <p className="text-sm font-medium">{profile.full_name || profile.email.split('@')[0]}</p>
              <p className="text-[11px] text-muted">{profile.role === 'admin' ? 'Administrador' : 'Atendente'}</p>
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
