import { LogOut } from 'lucide-react';
import { MessageNotifier, NotifyToggle } from '@/components/message-notifier';
import { RealtimeListener } from '@/components/realtime-listener';
import { Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { requireProfile } from '@/lib/auth';
import { demandsEnabled } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ count: pending }, { count: alerts }, { count: demands }, { data: settings }] = await Promise.all([
    supabase.from('pending_queue').select('id', { count: 'exact', head: true }),
    supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).in('status', ['aberta', 'em_andamento']),
    supabase
      .from('app_settings')
      .select(
        'demand_manual_enabled, demand_command_enabled, demand_keyword_enabled, demand_ai_enabled, msg_alert_enabled, msg_alert_auto_close, msg_alert_sound',
      )
      .eq('id', 1)
      .maybeSingle(),
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
        hidden={demandsEnabled(settings) ? [] : ['/demands']}
        user={{ name: profile.full_name || profile.email.split('@')[0], role: profile.role }}
      />
      <RealtimeListener />
      <MessageNotifier
        config={{
          enabled: settings?.msg_alert_enabled ?? true,
          autoClose: settings?.msg_alert_auto_close ?? 0,
          sound: settings?.msg_alert_sound ?? true,
        }}
      />
      <div className="transition-[padding] duration-200 lg:pl-64 lg:[[data-sidebar=collapsed]_&]:pl-[4.5rem]">
        <header className="sticky top-0 z-20 hidden items-center justify-end gap-2 border-b border-line bg-bg/80 px-8 py-3 backdrop-blur lg:flex">
          <NotifyToggle />
          <ThemeToggle />
          <div className="ml-2 flex items-center gap-3 rounded-xl px-2 py-1">
            {profile.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.avatar_url} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
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
