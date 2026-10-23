import { MessageNotifier } from '@/components/message-notifier';
import { RealtimeListener } from '@/components/realtime-listener';
import { Sidebar } from '@/components/sidebar';
import { currentCompany, requireProfile } from '@/lib/auth';
import { demandsEnabled } from '@/lib/format';
import { canSeeMenu, MENU_ITEMS } from '@/lib/menu';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ count: pending }, { count: alerts }, { count: demands }, { data: settings }, company, { data: companies }, { data: due }, { data: privateOk }] = await Promise.all([
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
    // conversas privadas (0069): só quem administra a plataforma, com o módulo ligado na empresa
    profile.platform_admin ? supabase.rpc('can_use_private_chats') : Promise.resolve({ data: false }),
  ]);
  // logo da empresa (0083; sem o script, a coluna não existe e fica sem logo)
  const { data: logoRow } = await supabase.from('companies').select('logo_path').eq('id', company?.id ?? '').maybeSingle();
  const companyLogo = Boolean((logoRow as { logo_path?: string | null } | null)?.logo_path);
  const privateUnread = privateOk
    ? ((await supabase.from('private_chats').select('unread_count').gt('unread_count', 0)).data ?? []).reduce(
        (n, c) => n + Number((c as { unread_count: number }).unread_count),
        0,
      )
    : 0;
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
        counts={{ pending: pending ?? 0, alerts: alerts ?? 0, demands: demands ?? 0, agenda: dueToday + dueLate + dueEvents, private: privateUnread }}
        // demandas desligadas nas configurações: o item some do menu
        // + os menus que a empresa ocultou para este usuário (Configurações › Menus)
        hidden={[
          ...(demandsEnabled(settings) ? [] : ['/demands', '/agenda']),
          ...(privateOk ? [] : ['/private']),
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
        user={{ name: profile.full_name || profile.email.split('@')[0], role: profile.role, initials, avatarUrl: profile.avatar_url }}
        platformAdmin={profile.platform_admin}
        alertsOff={profile.platform_admin ? Boolean(profile.alerts_off) : undefined}
        company={company?.name ?? null}
        companyLogo={companyLogo}
        companyId={company?.id ?? null}
        companies={profile.platform_admin ? (companies ?? undefined) : undefined}
        me={{
          id: profile.id,
          name: profile.full_name || profile.email.split('@')[0],
          email: profile.email,
          phone: profile.phone ?? null,
          initials,
          photoSrc: profile.photo_path ? `/profile-photo/${profile.id}` : null,
        }}
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
      <div className="transition-[padding] duration-200 lg:pl-56 lg:[[data-sidebar=collapsed]_&]:pl-[4.5rem]">

        <main className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-8 sm:py-8 has-[[data-wide]]:max-w-none">{children}</main>
      </div>
    </div>
  );
}
