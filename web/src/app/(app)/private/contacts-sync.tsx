'use client';

import { Loader2, RefreshCw, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { formatNumber, timeAgo } from '@/lib/format';
import { requestContactsSync } from './actions';

/**
 * Situação dos contatos do WhatsApp conectado e o botão "Sincronizar contatos" (0072).
 * Enquanto sincroniza, a tela se atualiza sozinha.
 */
export function ContactsSync({ status, syncedAt, count }: { status: string | null; syncedAt: string | null; count: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const syncing = status === 'syncing';
  useEffect(() => {
    if (!syncing) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [syncing, router]);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span className="inline-flex items-center gap-1.5 text-ink-2">
        <Users className="h-4 w-4 text-muted" />
        <strong className="tabular text-ink">{formatNumber(count)}</strong> contato(s)
        <span className="text-muted" suppressHydrationWarning>
          {syncing ? '· sincronizando…' : syncedAt ? `· sincronizado ${timeAgo(syncedAt)}` : status === 'failed' ? '· a última sincronização falhou' : ''}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending || syncing}
        title="Pede ao WhatsApp conectado a agenda com os nomes salvos e junta os membros de todos os grupos do número"
        onClick={() =>
          start(async () => {
            const res = await requestContactsSync();
            if (!res.ok) return void toast.error(res.error);
            toast.success('Sincronizando os contatos…', { description: 'Pode levar alguns minutos; a lista se atualiza sozinha.' });
            router.refresh();
          })
        }
      >
        {syncing || pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Sincronizar contatos
      </Button>
    </div>
  );
}
