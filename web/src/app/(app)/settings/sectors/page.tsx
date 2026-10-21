import { Building2 } from 'lucide-react';
import { AdminNotice } from '@/components/admin-notice';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { DefaultSector, NewSectorForm, SectorEditor, type SectorRow } from './sectors';

/**
 * Setores: cada grupo pertence a um setor e os usuários do setor só veem e atendem esses grupos,
 * com as permissões do setor. Administradores veem tudo.
 */
export default async function SectorsPage() {
  const me = await requireProfile();
  if (me.role !== 'admin') return <AdminNotice />;

  const supabase = await createClient();
  const [{ data: sectors }, { data: members }, { data: users }, { data: groups }, { data: settings }] = await Promise.all([
    supabase.from('sectors').select('*').order('name'),
    supabase.from('sector_members').select('sector_id, user_id'),
    supabase.from('profiles').select('id, full_name, email, role, active').order('full_name'),
    supabase.from('groups').select('id, name, sector_id, monitored').is('removed_at', null).order('name'),
    supabase.from('app_settings').select('default_sector_id').single(),
  ]);
  const list = (sectors ?? []) as SectorRow[];
  const allGroups = groups ?? [];
  const withoutSector = allGroups.filter((g) => !g.sector_id);
  const people = (users ?? []).map((u) => ({
    id: u.id as string,
    name: (u.full_name as string) || (u.email as string),
    email: u.email as string,
    admin: u.role === 'admin',
    active: Boolean(u.active),
  }));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-1">
        <Card>
          <CardHeader
            title="Novo setor"
            description="Ex.: Financeiro, Suporte, Comercial. Depois, marque os usuários e os grupos do setor."
          />
          <div className="p-5">
            <NewSectorForm />
          </div>
        </Card>
        <Card>
          <CardHeader title="Como funciona" />
          <ul className="space-y-2 px-5 pb-5 text-sm text-ink-2">
            <li>• Cada grupo pertence a <strong>um</strong> setor.</li>
            <li>
              • Os usuários do setor <strong>só veem</strong> os grupos do seu setor: conversas, painel, alertas, demandas,
              indicadores e relatórios. Um usuário pode estar em mais de um setor.
            </li>
            <li>• Em cada setor você escolhe se os usuários podem responder, gerenciar demandas e tratar alertas.</li>
            <li>
              • <strong>Administradores</strong> veem e fazem tudo. Grupos <strong>sem setor</strong> e usuários sem setor:
              só administradores veem esses grupos.
            </li>
            <li>• A regra é aplicada no banco de dados, em qualquer tela.</li>
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Setor dos grupos novos"
            description="Grupos que o número conectado entrar a partir de agora recebem este setor."
          />
          <div className="p-5">
            <DefaultSector sectors={list} value={settings?.default_sector_id ?? null} />
            {withoutSector.length > 0 && (
              <p className="mt-3 text-xs text-warning-ink">
                {withoutSector.length} grupo(s) sem setor (só administradores veem):{' '}
                {withoutSector
                  .slice(0, 6)
                  .map((g) => g.name)
                  .join(', ')}
                {withoutSector.length > 6 ? '…' : ''}
              </p>
            )}
          </div>
        </Card>
      </div>

      <div className="space-y-4 lg:col-span-2">
        {list.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Building2 />}
              title="Nenhum setor"
              description="Crie o primeiro setor ao lado. Enquanto não houver setores, só administradores veem os grupos."
            />
          </Card>
        ) : (
          list.map((s) => (
            <SectorEditor
              // a chave muda quando usuários/grupos mudam: o cartão recarrega com os dados atuais
              key={`${s.id}:${(members ?? []).filter((m) => m.sector_id === s.id).map((m) => m.user_id).sort().join(',')}:${allGroups
                .filter((g) => g.sector_id === s.id)
                .map((g) => g.id)
                .sort()
                .join(',')}:${s.name}:${s.can_reply}${s.can_manage_demands}${s.can_handle_alerts}`}
              sector={s}
              users={people}
              memberIds={(members ?? []).filter((m) => m.sector_id === s.id).map((m) => m.user_id as string)}
              groups={allGroups.map((g) => ({
                id: g.id as string,
                name: g.name as string,
                monitored: Boolean(g.monitored),
                sectorId: (g.sector_id as string | null) ?? null,
              }))}
              sectorNames={Object.fromEntries(list.map((x) => [x.id, x.name]))}
              isDefault={settings?.default_sector_id === s.id}
            />
          ))
        )}
      </div>
    </div>
  );
}
