'use client';

import { Loader2, UserCheck, UserX } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { setUserActive } from '@/app/(app)/settings/actions/users';

/** Inativar / Ativar a pessoa direto da lista (só administradores). Inativa: deixa de entrar no painel; o histórico continua. */
export function ActiveToggle({ userId, name, active }: { userId: string; name: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (active && !confirm(`Inativar ${name}?\n\nA pessoa deixa de entrar no painel. O histórico (demandas, alertas e log) continua com o nome dela, e dá para ativar de novo.`)) return;
        start(async () => {
          const res = await setUserActive(userId, !active);
          if (!res.ok) return void toast.error(res.error);
          toast.success(active ? `${name} foi inativada` : `${name} foi ativada`);
          router.refresh();
        });
      }}
      className={`mr-3 inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium disabled:opacity-50 sm:mr-4 ${
        active ? 'border-line text-ink-2 hover:border-critical/40 hover:bg-critical/10 hover:text-critical-ink' : 'border-brand-line text-brand-text hover:bg-brand-soft'
      }`}
      title={active ? 'Inativar: a pessoa deixa de entrar no painel' : 'Ativar: a pessoa volta a entrar no painel'}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : active ? <UserX className="h-3.5 w-3.5" /> : <UserCheck className="h-3.5 w-3.5" />}
      {active ? 'Inativar' : 'Ativar'}
    </button>
  );
}
