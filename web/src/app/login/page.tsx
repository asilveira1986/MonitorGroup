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
      <section className="relative hidden overflow-hidden bg-[#0b2a1a] p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#25b864] opacity-25 blur-3xl"
        />
        <div aria-hidden className="absolute -bottom-40 -left-20 h-96 w-96 rounded-full bg-[#3987e5] opacity-20 blur-3xl" />
        <div className="relative flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#25b864] text-[#04140a]">
            <QrCode className="h-5 w-5" />
          </div>
          <span className="font-semibold">MonitorGroup</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Nenhum cliente sem resposta nos seus grupos de WhatsApp.</h2>
          <ul className="mt-8 space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-white/80">
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#25b864]" />
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-white/50">© {new Date().getFullYear()} MonitorGroup</p>
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
