import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DefaultSector, SectorsList, type SectorRow } from './sectors';

/**
 * Setores (cadastro simples): cada grupo pertence a um setor e as pessoas do setor só veem e atendem
 * esses grupos; na Agenda, o setor marca todos de uma vez. Administradores veem tudo.
 */
export default async function SectorsPage() {
  const me = await requireProfile();
  if (me.role !== 'admin' && !me.platform_admin) return <AdminNotice />;

  const supabase = await createClient();
  const [{ data: sectors }, { data: members }, { data: users }, { data: groups }, { data: settings }] = await Promise.all([
    supabase.from('sectors').select('*').order('name'),
    supabase.from('sector_members').select('sector_id, user_id'),
    supabase.from('profiles').select('id, full_name, email, role, active, platform_admin').order('full_name'),
    supabase.from('groups').select('id, name, sector_id, monitored').is('removed_at', null).order('name'),
    supabase.from('app_settings').select('default_sector_id').single(),
  ]);
  const list = (sectors ?? []) as SectorRow[];
  const allGroups = groups ?? [];
  const withoutSector = allGroups.filter((g) => !g.sector_id);
  const people = (users ?? [])
    .filter((u) => me.platform_admin || !u.platform_admin)
    .map((u) => ({
      id: u.id as string,
      name: (u.full_name as string) || (u.email as string),
      email: u.email as string,
      admin: u.role === 'admin',
      active: Boolean(u.active),
    }));

  return (
    <div className="space-y-4">
      <SectorsList
        sectors={list}
        users={people}
        members={(members ?? []) as { sector_id: string; user_id: string }[]}
        groups={allGroups.map((g) => ({
          id: g.id as string,
          name: g.name as string,
          monitored: Boolean(g.monitored),
          sectorId: (g.sector_id as string | null) ?? null,
        }))}
        defaultSectorId={settings?.default_sector_id ?? null}
      />
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface px-5 py-3 text-sm">
        <span className="text-ink-2" title="Número com setor (Configurações › WhatsApp): os grupos novos dele vão para o setor do número">
          Grupos novos de número sem setor entram no setor
        </span>
        <div className="w-full sm:w-72">
          <DefaultSector sectors={list} value={settings?.default_sector_id ?? null} />
        </div>
        {withoutSector.length > 0 && (
          <span className="text-xs text-warning-ink">
            {withoutSector.length} grupo(s) sem setor (só administradores veem)
          </span>
        )}
      </div>
    </div>
  );
}
