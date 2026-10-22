import { Info, UserRound } from 'lucide-react';
import { ActionButton } from '@/components/action-button';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { TeamMember } from '@/lib/types';
import { removeTeamMember } from '../actions';
import { NewMemberForm } from './new-member-form';
import { AlertScope } from './alert-scope';
import { GrantAccess } from './grant-access';
import { RecalcButton } from './recalc-button';

export default async function TeamPage() {
  const profile = await requireProfile();
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
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title="Adicionar atendente" description="Números da sua equipe que respondem nos grupos." />
        <div className="p-5">
          <NewMemberForm />
          <div className="mt-5 flex gap-2 rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              Mensagens enviadas pelo número conectado já contam como equipe. Cadastre aqui os outros atendentes que
              respondem nos grupos pelo próprio celular. Você também pode clicar em <em>“é da equipe?”</em> em uma
              mensagem na tela do grupo.
            </p>
          </div>
        </div>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader
          title="Atendentes"
          description={`${members.length} atendente(s): quem responde nos grupos pelo WhatsApp. O login no painel fica em Acessos ao painel.`}
          action={profile.role === 'admin' ? <RecalcButton /> : undefined}
        />
        {profile.role === 'admin' && (
          <p className="px-4 pt-2 text-xs text-ink-2 sm:px-5">
            Cadastrou pessoas que já falavam nos grupos? <strong>Recalcular grupos</strong> passa as mensagens antigas delas
            para a equipe e tira de &quot;aguardando resposta&quot; os grupos que já foram respondidos (também roda sozinho
            ao adicionar alguém por aqui).
          </p>
        )}
        {profile.role === 'admin' && (
          <p className="px-4 pt-2 text-xs text-ink-2 sm:px-5">
            <strong>Avisos só dos seus grupos</strong>: a pessoa recebe os avisos em tela e voz (no usuário com acesso dela) e
            os avisos das regras por WhatsApp/e-mail apenas dos grupos em que é responsável e dos grupos sem responsável. Os responsáveis são escolhidos na
            tela de cada grupo.
          </p>
        )}
        <div className="p-2">
          {members.length === 0 ? (
            <EmptyState icon={<UserRound />} title="Nenhum atendente cadastrado" />
          ) : (
            <ul>
              {members.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                    {m.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1 basis-60">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted">
                      {m.phone ? formatPhone(m.phone) : 'Identificado pela conversa'}
                      {groupsOf.get(m.id) ? ` · responsável por ${groupsOf.get(m.id)} grupo(s)` : ''}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {profile.role === 'admin' && <AlertScope member={m} groups={groupsOf.get(m.id) ?? 0} />}
                    {profile.role === 'admin' && <GrantAccess member={m} />}
                    <ActionButton
                      action={removeTeamMember.bind(null, m.id)}
                      variant="ghost"
                      confirm={`Remover ${m.name} da equipe?`}
                      success="Removido"
                    >
                      Remover
                    </ActionButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
