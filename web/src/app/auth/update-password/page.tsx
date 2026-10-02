'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

export default function UpdatePasswordPage() {
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
    const { error } = await createClient().auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Senha atualizada!');
    router.replace('/dashboard');
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-8 shadow-sm">
        <h1 className="text-lg font-semibold">Definir nova senha</h1>
        <Field label="Nova senha">
          <Input name="password" type="password" minLength={8} required autoComplete="new-password" />
        </Field>
        <Field label="Confirmar senha">
          <Input name="confirm" type="password" minLength={8} required autoComplete="new-password" />
        </Field>
        <Button className="w-full" disabled={loading}>
          {loading ? 'Salvando…' : 'Salvar senha'}
        </Button>
      </form>
    </main>
  );
}
