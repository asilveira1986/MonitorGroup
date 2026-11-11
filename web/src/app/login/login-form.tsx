'use client';

import { Loader2, MailCheck } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import { clearPanelFilters } from '@/lib/panel-defaults';
import { explainAuthError } from '@/lib/auth-errors';

const explain = explainAuthError;

export function LoginForm({ configProblem }: { configProblem: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/panel';
  const [loading, setLoading] = useState<'password' | 'reset' | null>(null);
  const [email, setEmail] = useState('');
  const emailInput = useRef<HTMLInputElement>(null);
  // link de redefinição enviado: aviso fixo na tela e espera de 60 s para pedir outro (o Supabase limita os envios)
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  // o Supabase também devolve o erro do link (vencido, já usado) no "#" do endereço, que só o navegador enxerga
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const reason = hash.get('error_description') ?? hash.get('error_code') ?? hash.get('error');
    if (!reason) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    toast.error(explain(reason.replace(/\+/g, ' ')), { duration: 15_000 });
  }, []);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

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
    // o painel abre no padrão de quem entrou, sem herdar os filtros de quem usou este navegador antes
    clearPanelFilters(typeof window === 'undefined' ? null : window.sessionStorage);
    router.replace(next);
    router.refresh();
  }

  async function resetPassword() {
    if (!email.trim()) {
      toast.info('Digite seu e-mail no campo acima e clique em "Esqueci minha senha" de novo.');
      emailInput.current?.focus();
      return;
    }
    if (wait > 0) return;
    setLoading('reset');
    try {
      const { error } = await createClient().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: `${window.location.origin}/auth/callback?next=/auth/update-password`,
      });
      if (error) throw error;
      setSentTo(email.trim().toLowerCase());
      setWait(60);
      toast.success('Enviamos um link para redefinir sua senha.');
    } catch (err) {
      setSentTo(null);
      toast.error(explain(err instanceof Error ? err.message : String(err)), { duration: 15_000 });
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
            ref={emailInput}
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

      {sentTo && (
        <div className="rounded-xl border border-good/30 bg-good/10 px-3 py-2.5 text-sm text-good-ink" role="status">
          <p className="flex items-center gap-1.5 font-semibold">
            <MailCheck className="h-4 w-4" aria-hidden /> Link enviado para {sentTo}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
            <li>Abra o link neste mesmo navegador e aparelho em que você pediu.</li>
            <li>Ele vale por 1 hora e funciona uma vez só.</li>
            <li>Não chegou? Veja o spam. Só e-mails cadastrados no sistema recebem o link.</li>
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={resetPassword}
        disabled={loading !== null || wait > 0}
        className="w-full text-center text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-60"
      >
        {loading === 'reset' ? 'Enviando…' : wait > 0 ? `Esqueci minha senha (novo link em ${wait} s)` : sentTo ? 'Enviar outro link' : 'Esqueci minha senha'}
      </button>
    </div>
  );
}
