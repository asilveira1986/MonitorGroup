import { ChevronRight, Info, ShieldCheck, UserRound } from 'lucide-react';
import { AdminNotice } from '@/components/admin-notice';
import { RowMenu, type RowAction } from '@/components/disclosure';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import { deleteUser, removeAllowedEmail, updateUser } from '../actions';
import { NewUserDialog } from './new-user-form';
import { RoleSelect } from './role-select';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/roles';

/** Organização › Acessos ao painel: quem entra no sistema e com qual perfil. */
export default async function UsersPage() {
  const me = await requireProfile();
  if (me.role !== 'admin') return <AdminNotice />;

  const supabase = await createClient();
  const [{ data: profiles }, { data: allowed }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('allowed_emails').select('*').order('created_at'),
  ]);
  // quem administra a plataforma e está aqui para suporte não aparece para a empresa
  const users = ((profiles ?? []) as Profile[]).filter((u) => me.platform_admin || !u.platform_admin);
  const invites = (allowed ?? []).filter((a) => !users.some((u) => u.email === a.email));

  const actionsFor = (u: Profile): RowAction[] => [
    u.active
      ? { label: 'Bloquear acesso', action: removeAllowedEmail.bind(null, u.email), confirm: `Bloquear o acesso de ${u.email}?`, success: 'Acesso bloqueado' }
      : { label: 'Liberar acesso', action: updateUser.bind(null, u.id, { active: true }), success: 'Acesso liberado' },
    ...(me.platform_admin
      ? [
          {
            label: 'Excluir usuário',
            danger: true,
            action: deleteUser.bind(null, u.id),
            confirm: `Excluir de vez o usuário ${u.email}?\n\nO login e o perfil são apagados e não dá para desfazer. O histórico (demandas, alertas e log) continua com o nome dele.`,
            success: 'Usuário excluído',
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Acessos ao painel" description={`${users.length} pessoa(s) com login`} action={<NewUserDialog />} />
        <ul className="divide-y divide-line border-t border-line">
          {users.map((u) => (
            <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink-2">
                <UserRound className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-sm font-medium">
                  {u.full_name || u.email} {u.id === me.id && <span className="font-normal text-muted">(você)</span>}
                </p>
                <p className="truncate text-xs text-muted">
                  {u.email}
                  <span className="hidden sm:inline"> · desde {timeAgo(u.created_at)}</span>
                </p>
              </div>
              <div className="ml-auto flex items-center gap-2">
              {!u.active && <Badge tone="critical">Sem acesso</Badge>}
              {u.id === me.id ? (
                <Badge tone="brand">
                  <ShieldCheck className="h-3 w-3" /> {ROLE_LABEL[u.role]}
                </Badge>
              ) : (
                <>
                  <span title={ROLE_HINT[u.role]}>
                    <RoleSelect userId={u.id} role={u.role} />
                  </span>
                  <RowMenu actions={actionsFor(u)} label={`Ações de ${u.email}`} />
                </>
              )}
              </div>
            </li>
          ))}
          {users.length === 0 && (
            <li>
              <EmptyState icon={<UserRound />} title="Ninguém com acesso ainda" />
            </li>
          )}
        </ul>
      </Card>

      {invites.length > 0 && (
        <details className="group rounded-2xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium sm:px-5">
            <ChevronRight className="h-4 w-4 text-muted transition group-open:rotate-90" />
            Convites pendentes <span className="tabular rounded-full bg-surface-2 px-2 text-[11px] text-ink-2">{invites.length}</span>
          </summary>
          <p className="px-4 pb-2 text-xs text-ink-2 sm:px-5">
            E-mails autorizados que ainda não entraram. Sem senha cadastrada, remova e cadastre de novo com uma senha inicial.
          </p>
          <ul className="divide-y divide-line border-t border-line">
            {invites.map((i) => (
              <li key={i.email} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-muted">{ROLE_LABEL[i.role as keyof typeof ROLE_LABEL] ?? i.role}</p>
                </div>
                <RowMenu
                  label={`Ações do convite ${i.email}`}
                  actions={[{ label: 'Remover convite', danger: true, action: removeAllowedEmail.bind(null, i.email), success: 'Convite removido' }]}
                />
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="flex items-start gap-1.5 px-1 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Acesso é o login no painel. Quem responde nos grupos pelo WhatsApp fica em Atendentes; para a pessoa ter agenda e
        entregar demandas, ligue o acesso dela lá (Dar acesso ao sistema).
      </p>
    </div>
  );
}
