import { ShieldCheck, UserRound } from 'lucide-react';
import { AdminNotice } from '@/components/admin-notice';
import { ActionButton } from '@/components/action-button';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import { removeAllowedEmail, updateUser } from '../actions';
import { NewUserForm } from './new-user-form';

export default async function UsersPage() {
  const me = await requireProfile();
  if (me.role !== 'admin') return <AdminNotice />;

  const supabase = await createClient();
  const [{ data: profiles }, { data: allowed }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('allowed_emails').select('*').order('created_at'),
  ]);
  const users = (profiles ?? []) as Profile[];
  const invites = (allowed ?? []).filter((a) => !users.some((u) => u.email === a.email));

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <CardHeader title="Cadastrar usuário" description="Somente e-mails cadastrados conseguem entrar." />
        <div className="p-5">
          <NewUserForm />
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardHeader title="Usuários" description={`${users.length} usuário(s)`} />
          <div className="p-2">
            {users.map((u) => (
              <div key={u.id} className="flex flex-col gap-3 rounded-xl px-3 py-3 hover:bg-surface-2 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {u.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatar_url} alt="" className="h-9 w-9 rounded-full" />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-brand">
                      <UserRound className="h-4 w-4" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {u.full_name || u.email} {u.id === me.id && <span className="text-muted">(você)</span>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {u.email} · desde {timeAgo(u.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {u.role === 'admin' ? (
                    <Badge tone="brand">
                      <ShieldCheck className="h-3 w-3" /> Admin
                    </Badge>
                  ) : (
                    <Badge>Atendente</Badge>
                  )}
                  {!u.active && <Badge tone="critical">Sem acesso</Badge>}
                  {u.id !== me.id && (
                    <>
                      <ActionButton
                        variant="ghost"
                        action={updateUser.bind(null, u.id, { role: u.role === 'admin' ? 'agent' : 'admin' })}
                        success="Permissão atualizada"
                      >
                        {u.role === 'admin' ? 'Tornar atendente' : 'Tornar admin'}
                      </ActionButton>
                      {u.active ? (
                        <ActionButton
                          variant="ghost"
                          action={removeAllowedEmail.bind(null, u.email)}
                          confirm={`Bloquear o acesso de ${u.email}?`}
                          success="Acesso bloqueado"
                        >
                          Bloquear
                        </ActionButton>
                      ) : (
                        <ActionButton action={updateUser.bind(null, u.id, { active: true })} success="Acesso liberado">
                          Liberar acesso
                        </ActionButton>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Convites pendentes"
            description="E-mails autorizados que ainda não entraram (podem entrar com Google)."
          />
          <div className="p-2">
            {invites.length === 0 ? (
              <EmptyState icon={<UserRound />} title="Nenhum convite pendente" />
            ) : (
              invites.map((i) => (
                <div key={i.email} className="flex items-center justify-between rounded-xl px-3 py-3 hover:bg-surface-2">
                  <div>
                    <p className="text-sm font-medium">{i.email}</p>
                    <p className="text-xs text-muted">{i.role === 'admin' ? 'Administrador' : 'Atendente'}</p>
                  </div>
                  <ActionButton variant="ghost" action={removeAllowedEmail.bind(null, i.email)} success="Convite removido">
                    Remover
                  </ActionButton>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
