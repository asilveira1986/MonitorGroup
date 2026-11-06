'use client';

import { Pause, Play, RotateCcw, XCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { useRealtime } from '@/lib/use-realtime';
import { retryBroadcastFailures, setBroadcastStatus } from '../actions';

/** Pausar, retomar e cancelar o disparo. */
export function Controls({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (action: 'pause' | 'resume' | 'cancel') => {
    if (action === 'cancel' && !confirm('Cancelar o disparo? O que ainda não foi enviado não será enviado.')) return;
    start(async () => {
      const r = await setBroadcastStatus(id, action);
      if (r.ok) router.refresh();
      else toast.error(r.error);
    });
  };
  return (
    <>
      {status === 'paused' ? (
        <Button variant="secondary" onClick={() => run('resume')} disabled={pending}>
          <Play className="h-4 w-4" /> Retomar
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => run('pause')} disabled={pending}>
          <Pause className="h-4 w-4" /> Pausar
        </Button>
      )}
      <Button variant="danger" onClick={() => run('cancel')} disabled={pending}>
        <XCircle className="h-4 w-4" /> Cancelar
      </Button>
    </>
  );
}

/** Atualiza a tela conforme os envios acontecem (no máximo a cada 4 s). */
export function LiveRefresh() {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = () => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      router.refresh();
    }, 4000);
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  useRealtime('broadcast-live', (ch) =>
    ch
      .on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_recipients' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'broadcast_campaigns' }, refresh),
  );
  return null;
}

/** Devolve as falhas para a fila: o envio recomeça por elas, no mesmo ritmo. */
export function RetryFailures({ id, failed }: { id: string; failed: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await retryBroadcastFailures(id);
          if (r.ok) {
            toast.success(`${r.count} destinatário(s) voltaram para a fila.`);
            router.refresh();
          } else toast.error(r.error);
        })
      }
    >
      <RotateCcw className="h-4 w-4" /> Reenviar {failed} falha{failed > 1 ? 's' : ''}
    </Button>
  );
}
