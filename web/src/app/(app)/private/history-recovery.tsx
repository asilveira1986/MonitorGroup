'use client';

import { History } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_DAYS } from '@/lib/history-recovery';
import { HistoryRecoveryPanel } from '../groups/[id]/history-recovery';
import type { HistoryRequestView } from '../groups/history-actions';
import { cancelPrivateRecovery, latestPrivateRecovery, startPrivateRecovery } from './history-actions';

/** Botão "Recuperar mensagens" da conversa privada (só o administrador geral): abre a janela e acompanha o pedido. */
export function PrivateHistoryRecoveryButton({ chatId, timeZone }: { chatId: string; timeZone?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [request, setRequest] = useState<HistoryRequestView | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const lastStatus = useRef<string | null>(null);

  const apply = (res: Awaited<ReturnType<typeof latestPrivateRecovery>>, quiet: boolean) => {
    if (!quiet) setLoading(false);
    if (!res.ok) return void (quiet || toast.error(res.error));
    setRequest(res.request);
    const was = lastStatus.current;
    const done = res.request && res.request.status !== 'pending' && res.request.status !== 'running';
    // concluiu trazendo mensagens novas: mostra na conversa
    if (done && (was === 'running' || was === 'pending') && res.request!.added > 0) router.refresh();
    lastStatus.current = res.request?.status ?? null;
  };
  const refresh = async () => apply(await latestPrivateRecovery(chatId), true);

  // abre: busca o pedido mais recente; enquanto estiver em andamento, confere a cada 4 s
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void latestPrivateRecovery(chatId).then((res) => alive && apply(res, false));
    const timer = setInterval(() => {
      if (alive && (lastStatus.current === 'pending' || lastStatus.current === 'running')) void latestPrivateRecovery(chatId).then((res) => alive && apply(res, true));
    }, 4000);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', esc);
    window.addEventListener('mousedown', outside);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('mousedown', outside);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId]);

  const start = async () => {
    setBusy(true);
    try {
      const res = await startPrivateRecovery(chatId, days);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Pedido na fila: o worker começa em instantes');
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (!request) return;
    setBusy(true);
    try {
      const res = await cancelPrivateRecovery(request.id);
      if (!res.ok) return void toast.error(res.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) setLoading(true);
          setOpen(!open);
        }}
        aria-expanded={open}
        className="inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-surface px-2 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink sm:h-7"
        title="Recuperar mensagens que não foram guardadas (experimental, só administrador geral)"
      >
        <History className="h-3.5 w-3.5" /> <span className="hidden lg:inline">Recuperar</span>
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30">
          <HistoryRecoveryPanel
            kind="private"
            request={request}
            loading={loading}
            busy={busy}
            days={days}
            onDays={setDays}
            onStart={() => void start()}
            onCancel={() => void cancel()}
            onClose={() => setOpen(false)}
            timeZone={timeZone}
          />
        </div>
      )}
    </div>
  );
}
