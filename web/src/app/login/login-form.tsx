'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1A6.6 6.6 0 0 1 5.5 12c0-.73.13-1.44.34-2.1V7.06H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.94l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/dashboard';
  const [loading, setLoading] = useState<'password' | 'google' | 'reset' | null>(null);
  const [email, setEmail] = useState('');

  async function signInWithPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setLoading('password');
    const { error } = await createClient().auth.signInWithPassword({
      email: String(form.get('email')).trim().toLowerCase(),
      password: String(form.get('password')),
    });
    if (error) {
      setLoading(null);
      toast.error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  async function signInWithGoogle() {
    setLoading('google');
    const { error } = await createClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    if (error) {
      setLoading(null);
      toast.error(error.message);
    }
  }

  async function resetPassword() {
    if (!email) {
      toast.info('Digite seu e-mail para receber o link de redefinição.');
      return;
    }
    setLoading('reset');
    const { error } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
    });
    setLoading(null);
    if (error) toast.error(error.message);
    else toast.success('Enviamos um link para redefinir sua senha.');
  }

  return (
    <div className="mt-8 space-y-6">
      {params.get('error') && (
        <p className="rounded-xl bg-critical/10 px-3 py-2 text-sm text-critical-ink">
          Não foi possível concluir o login. Tente novamente.
        </p>
      )}

      <Button type="button" variant="secondary" className="w-full" onClick={signInWithGoogle} disabled={loading !== null}>
        {loading === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleIcon />}
        Entrar com Google
      </Button>

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" /> ou com e-mail <span className="h-px flex-1 bg-line" />
      </div>

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
