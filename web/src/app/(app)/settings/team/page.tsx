import { Info, ShieldCheck, UserRound } from 'lucide-react';
import { RowMenu } from '@/components/disclosure';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { TeamMember } from '@/lib/types';
import { removeTeamMember } from '../actions';
import { NewMemberDialog } from './new-member-form';
import { AlertScope } from './alert-scope';
import { GrantAccess } from './grant-access';
import { RecalcButton } from './recalc-button';

/** Organização › Atendentes: quem responde nos grupos pelo WhatsApp. */
export default async function TeamPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin';
  const supabase = await createClient();
  const [{ data }, { data: groupRows }] = await Promise.all([
    supabase.from('team_members').select('*').order('name'),
    supabase.from('groups').select('responsible_member_ids').is('removed_at', null),
  ]);
  const members = (data ?? []) as TeamMember[];
  // quantos grupos cada pessoa tem como responsável
  const groupsOf = new Map<string, number>();
  for (const g of (groupRows ?? []) as { responsible_member_ids: string[] | null }[])
    for (const id of g.responsible_member_ids ?? []) groupsOf.set(id, (groupsOf.get(id) ?? 0) + 1);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Atendentes"
          description={`${members.length} pessoa(s) que respondem nos grupos`}
          action={
            <div className="flex flex-wrap items-center gap-1">
              {isAdmin && <RecalcButton />}
              <NewMemberDialog />
            </div>
          }
        />
        <ul className="divide-y divide-line border-t border-line">
          {members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                {m.name.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-muted">
                  {m.phone ? formatPhone(m.phone) : 'Identificado pela conversa'}
                  {groupsOf.get(m.id) ? ` · responsável por ${groupsOf.get(m.id)} grupo(s)` : ''}
                </p>
                {m.user_email && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-good-ink" title="Entra no painel com este e-mail">
                    <ShieldCheck className="h-3 w-3 shrink-0" /> {m.user_email}
                  </p>
                )}
              </div>
              <div className="ml-auto flex items-center gap-1">
                {isAdmin && <AlertScope member={m} groups={groupsOf.get(m.id) ?? 0} />}
                {isAdmin && <GrantAccess member={m} />}
                <RowMenu
                  label={`Ações de ${m.name}`}
                  actions={[
                    {
                      label: 'Remover da equipe',
                      danger: true,
                      action: removeTeamMember.bind(null, m.id),
                      confirm: `Remover ${m.name} da equipe?`,
                      success: 'Removido',
                    },
                  ]}
                />
              </div>
            </li>
          ))}
          {members.length === 0 && (
            <li>
              <EmptyState icon={<UserRound />} title="Nenhum atendente cadastrado" />
            </li>
          )}
        </ul>
      </Card>
      <p className="flex items-start gap-1.5 px-1 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        As mensagens do número conectado já contam como equipe; cadastre aqui quem responde pelo próprio celular (ou clique em
        “é da equipe?” numa mensagem do grupo). “Avisos só dos seus grupos”: a pessoa recebe avisos apenas dos grupos em que é
        responsável e dos grupos sem responsável.
      </p>
    </div>
  );
}
