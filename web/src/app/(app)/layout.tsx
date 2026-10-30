import { MessageNotifier } from '@/components/message-notifier';
import { PresenceProvider } from '@/components/presence';
import { RealtimeListener } from '@/components/realtime-listener';
import { Sidebar } from '@/components/sidebar';
import { currentCompany, requireProfile } from '@/lib/auth';
import { demandsEnabled } from '@/lib/format';
import { canSeeMenu, MENU_ITEMS } from '@/lib/menu';
import { createClient } from '@/lib/supabase/server';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ count: pending }, { count: alerts }, { count: demands }, { data: settings }, company, { data: companies }, { data: due }, { data: privateOk }, { data: logoRow }, { data: unreadRows }] = await Promise.all([
    supabase.from('pending_queue').select('id', { count: 'exact', head: true }),
    supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('status', 'open'),
    supabase.from('demands').select('id', { count: 'exact', head: true }).in('status', ['aberta', 'em_andamento']),
    supabase
      .from('app_settings')
      // tudo da linha: coluna nova que ainda não existe no banco não derruba a consulta
      .select('*')
      .maybeSingle(),
    currentCompany(),
    // quem administra a plataforma troca de empresa pelo topo
    profile.platform_admin
      ? supabase.from('companies').select('id, name, active, logo_path').order('name')
      : Promise.resolve({ data: null }),
    // agenda: demandas do usuário para entregar hoje e atrasadas (sem o script 0059, nada)
    supabase.rpc('my_due_demands'),
    // conversas privadas (0114): administradores e atendentes, com o módulo ligado na empresa
    supabase.rpc('can_use_private_chats'),
    // logo da empresa (0083) e não lidas do privado: junto com o resto (uma ida ao banco só)
    supabase.from('companies').select('logo_path').eq('id', profile.company_id ?? '').maybeSingle(),
    // não lidas: as do usuário e as sem responsável (as que avisam ele)
    supabase.from('private_chats').select('unread_count').gt('unread_count', 0).or(`assigned_to.is.null,assigned_to.eq.${profile.id}`),
  ]);
  const companyLogo = Boolean((logoRow as { logo_path?: string | null } | null)?.logo_path);
  const privateUnread = privateOk
    ? ((unreadRows ?? []) as { unread_count: number }[]).reduce((n, c) => n + Number(c.unread_count), 0)
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
          // a Agenda funciona sem as demandas (compromissos); só as Demandas somem
          ...(demandsEnabled(settings) ? [] : ['/demands']),
          ...(privateOk ? [] : ['/private', '/contacts']),
          ...MENU_ITEMS.filter(
            (i) =>
              !canSeeMenu(
                settings?.menu_access as Record<string, unknown> | null,
                i.href,
                profile.role === 'admin' || profile.platform_admin,
                profile.role === 'viewer',
                profile.role === 'agenda',
              ),
          ).map((i) => i.href),
        ]}
        user={{ name: profile.full_name || profile.email.split('@')[0], role: profile.role, initials, avatarUrl: profile.avatar_url }}
        platformAdmin={profile.platform_admin}
        alertsOff={profile.platform_admin ? Boolean(profile.alerts_off) : undefined}
        company={company?.name ?? null}
        companyLogo={companyLogo}
        companyId={company?.id ?? null}
        companies={
          profile.platform_admin
            ? ((companies ?? []) as { id: string; name: string; active: boolean; logo_path?: string | null }[]).map((c) => ({
                id: c.id,
                name: c.name,
                active: c.active,
                hasLogo: Boolean(c.logo_path),
              }))
            : undefined
        }
        me={{
          id: profile.id,
          name: profile.full_name || profile.email.split('@')[0],
          email: profile.email,
          phone: profile.phone ?? null,
          initials,
          photoSrc: profile.photo_path ? `/profile-photo/${profile.id}` : null,
          role: profile.role,
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
          // conversas privadas (0120); sem o script, tudo ligado
          privateMine: (settings as { private_alert_mine?: boolean } | null)?.private_alert_mine ?? true,
          privateQueue: (settings as { private_alert_queue?: boolean } | null)?.private_alert_queue ?? true,
          privateSound: (settings as { private_alert_sound?: boolean } | null)?.private_alert_sound ?? true,
          privateVoice: (settings as { private_alert_voice?: boolean } | null)?.private_alert_voice ?? true,
        }}
      />
      <div className="transition-[padding] duration-200 lg:pl-60 lg:[[data-sidebar=collapsed]_&]:pl-[4.5rem]">

        <main className="mx-auto max-w-7xl px-4 pb-10 pt-5 sm:px-8 sm:py-8 has-[[data-wide]]:max-w-none">
          {/* quem está online agora (bolinha verde na foto dos usuários) */}
          <PresenceProvider companyId={company?.id ?? profile.company_id ?? null} userId={profile.id}>
            {children}
          </PresenceProvider>
        </main>
      </div>
    </div>
  );
}
