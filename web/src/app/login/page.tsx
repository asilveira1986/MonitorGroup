import { BellRing, CheckCircle2, LineChart, QrCode } from 'lucide-react';
import { Suspense } from 'react';
import { Logo } from '@/components/logo';
import { configProblem } from '@/lib/supabase/config';
import { LoginForm } from './login-form';

const FEATURES = [
  { icon: QrCode, text: 'Conecte o WhatsApp lendo um QR code, sem instalar nada' },
  { icon: CheckCircle2, text: 'Saiba em tempo real quais clientes estão aguardando resposta' },
  { icon: LineChart, text: 'Tempo de resposta, SLA e volume por grupo e por atendente' },
  { icon: BellRing, text: 'Alertas por e-mail, WhatsApp ou webhook quando algo foge do combinado' },
];

export default function LoginPage() {
  const problem = configProblem();
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="theme-deep relative hidden overflow-hidden p-12 lg:flex lg:flex-col lg:justify-between">
        {/* o pulso do símbolo, grande e discreto, ao fundo */}
        <svg
          aria-hidden
          viewBox="0 0 64 40"
          className="pointer-events-none absolute -right-24 bottom-24 w-[640px] text-[#C6F432] opacity-[0.07]"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="2,20 14,20 22,5 32,35 42,5 50,20 62,20" />
        </svg>
        <Logo size={40} className="relative" />
        <div className="relative max-w-md">
          <span className="font-mono inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] uppercase tracking-[0.08em] text-ink-2">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden /> Monitoramento ao vivo
          </span>
          <h2 className="mt-5 text-4xl font-bold leading-tight">Nenhuma conversa fica sem resposta.</h2>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-ink-2">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-brand-text" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-muted">© {new Date().getFullYear()} Monitor Group</p>
      </section>

      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
          <p className="mt-1 text-sm text-ink-2">Use seu e-mail cadastrado ou sua conta Google.</p>
          <Suspense>
            <LoginForm configProblem={problem} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}
