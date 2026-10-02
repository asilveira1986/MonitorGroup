import { Info, UserRound } from 'lucide-react';
import { ActionButton } from '@/components/action-button';
import { Card, CardHeader, EmptyState } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { TeamMember } from '@/lib/types';
import { removeTeamMember } from '../actions';
import { NewMemberForm } from './new-member-form';

export default async function TeamPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('team_members').select('*').order('name');
  const members = (data ?? []) as TeamMember[];

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
        <CardHeader title="Equipe" description={`${members.length} atendente(s)`} />
        <div className="p-2">
          {members.length === 0 ? (
            <EmptyState icon={<UserRound />} title="Nenhum atendente cadastrado" />
          ) : (
            <ul>
              {members.map((m) => (
                <li key={m.id} className="flex items-center gap-3 rounded-xl px-3 py-3 hover:bg-surface-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                    {m.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.name}</p>
                    <p className="text-xs text-muted">{m.phone ? formatPhone(m.phone) : 'Identificado pela conversa'}</p>
                  </div>
                  <ActionButton
                    action={removeTeamMember.bind(null, m.id)}
                    variant="ghost"
                    confirm={`Remover ${m.name} da equipe?`}
                    success="Removido"
                  >
                    Remover
                  </ActionButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
