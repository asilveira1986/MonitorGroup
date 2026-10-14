'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

/** Traduz as mensagens do Supabase para algo que diga o que fazer. */
function explain(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('email not confirmed'))
    return 'E-mail ainda não confirmado. No Supabase, abra Authentication › Users, clique no usuário e confirme o e-mail (ou recrie com "Auto confirm user").';
  if (m.includes('invalid api key') || m.includes('no api key'))
    return 'Chave do Supabase inválida. Confira NEXT_PUBLIC_SUPABASE_ANON_KEY na Vercel e faça um novo deploy.';
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed'))
    return 'Não foi possível conectar ao Supabase. Confira NEXT_PUBLIC_SUPABASE_URL na Vercel e se o projeto do Supabase está ativo (projetos gratuitos pausam após 7 dias sem uso).';
  if (m.includes('signups not allowed') || m.includes('signup is disabled'))
    return 'Cadastro de novos usuários desativado no Supabase. Ative "Allow new users to sign up" em Authentication › Sign In / Providers.';
  if (m.includes('database error saving new user'))
    return 'Erro no banco ao criar o usuário. Verifique se os scripts SQL (0001 a 0004) foram executados no Supabase.';
  if (m.includes('redirect') || m.includes('code verifier') || m.includes('pkce'))
    return 'Falha no retorno do login. No Supabase, em Authentication › URL Configuration, coloque o endereço do painel em Site URL e em Redirect URLs (com /** no final). Abra o login sempre pelo mesmo endereço.';
  return message;
}

export function LoginForm({ configProblem }: { configProblem: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';
  const [loading, setLoading] = useState<'password' | 'reset' | null>(null);
  const [email, setEmail] = useState('');

  async function signInWithPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading('password');
    let message: string | null = null;
    try {
      const { error } = await createClient().auth.signInWithPassword({
        email: String(form.get('email')).trim().toLowerCase(),
        password: String(form.get('password')),
      });
      message = error?.message ?? null;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    if (message) {
      setLoading(null);
      toast.error(explain(message), { duration: 12_000 });
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function resetPassword() {
    if (!email) {
      toast.info('Digite seu e-mail para receber o link de redefinição.');
      return;
    }
    setLoading('reset');
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
      });
      if (error) throw error;
      toast.success('Enviamos um link para redefinir sua senha.');
    } catch (err) {
      toast.error(explain(err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="mt-8 space-y-6">
      {configProblem && (
        <div className="rounded-xl border border-critical/30 bg-critical/10 px-3 py-2 text-sm text-critical-ink">
          <p className="font-semibold">Configuração incompleta</p>
          <p className="mt-1">{configProblem}</p>
        </div>
      )}
      {params.get('error') && (
        <div className="rounded-xl bg-critical/10 px-3 py-2 text-sm text-critical-ink">
          <p className="font-semibold">Não foi possível concluir o login</p>
          {params.get('error') !== 'auth' && <p className="mt-1">{explain(params.get('error')!)}</p>}
        </div>
      )}

      <form onSubmit={signInWithPassword} className="space-y-4">
        <Field label="E-mail">
          <Input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="voce@empresa.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Senha">
          <Input name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
        </Field>
        <Button className="w-full" disabled={loading !== null}>
          {loading === 'password' && <Loader2 className="h-4 w-4 animate-spin" />}
          Entrar
        </Button>
      </form>

      <button
        type="button"
        onClick={resetPassword}
        disabled={loading !== null}
        className="w-full text-center text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline"
      >
        Esqueci minha senha
      </button>
    </div>
  );
}
