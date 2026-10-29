'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input } from '@/components/ui';
import { changeOwnPassword } from './actions';

export function UpdatePasswordForm({ firstAccess }: { firstAccess: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get('password'));
    if (password !== form.get('confirm')) {
      toast.error('As senhas não conferem.');
      return;
    }
    setLoading(true);
    const res = await changeOwnPassword(password);
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success('Senha atualizada!');
    router.replace('/dashboard');
    router.refresh();
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">{firstAccess ? 'Crie a sua senha' : 'Definir nova senha'}</h1>
          {firstAccess && (
            <p className="text-sm text-ink-2">Este é o seu primeiro acesso com a senha que recebeu. Para continuar, defina uma senha só sua.</p>
          )}
        </div>
        <Field label="Nova senha" hint="Ao menos 8 caracteres.">
          <Input name="password" type="password" minLength={8} required autoComplete="new-password" autoFocus />
        </Field>
        <Field label="Confirmar senha">
          <Input name="confirm" type="password" minLength={8} required autoComplete="new-password" />
        </Field>
        <Button className="w-full" disabled={loading}>
          {loading ? 'Salvando…' : 'Salvar senha'}
        </Button>
      </form>
      {firstAccess && (
        <form action="/auth/signout" method="post">
          <button className="text-xs text-muted hover:text-ink">Sair</button>
        </form>
      )}
    </main>
  );
}
