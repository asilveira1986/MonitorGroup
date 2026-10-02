import { ShieldAlert } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

export default async function PendingAccessPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-warning/15 text-warning-ink">
          <ShieldAlert className="h-6 w-6" />
        </div>
        <h1 className="text-lg font-semibold">Acesso não liberado</h1>
        <p className="mt-2 text-sm text-ink-2">
          {user?.email ? (
            <>
              O e-mail <strong>{user.email}</strong> ainda não foi autorizado.
            </>
          ) : (
            'Seu usuário ainda não foi autorizado.'
          )}{' '}
          Peça a um administrador para cadastrá-lo em <em>Configurações &gt; Usuários</em>.
        </p>
        <form action="/auth/signout" method="post" className="mt-6">
          <button className="h-10 w-full rounded-xl border border-line text-sm font-medium hover:bg-surface-2">
            Sair e usar outra conta
          </button>
        </form>
      </div>
    </main>
  );
}
