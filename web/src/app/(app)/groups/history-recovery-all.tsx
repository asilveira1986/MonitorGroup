'use client';

import { History, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button } from '@/components/ui';
import { formatNumber } from '@/lib/format';
import { batchOpen, batchProgress, DAY_OPTIONS, DEFAULT_DAYS, type BatchStatus } from '@/lib/history-recovery';
import { cancelHistoryRecoveryBatch, historyRecoveryBatchStatus, startHistoryRecoveryAll } from './history-actions';

/** Janela da recuperação em todos os grupos (só apresentação: quem busca e grava é o HistoryRecoveryAllButton). */
export function HistoryRecoveryAllPanel({
  status,
  loading,
  busy,
  days,
  onDays,
  onlyUnmonitored,
  onOnlyUnmonitored,
  onStart,
  onCancel,
  onClose,
}: {
  status: BatchStatus | null;
  loading: boolean;
  busy: boolean;
  days: number;
  onDays: (days: number) => void;
  onlyUnmonitored: boolean;
  onOnlyUnmonitored: (value: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const open = status ? batchOpen(status) : false;
  const progress = status ? batchProgress(status) : null;
  return (
    <div className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-4 text-left shadow-xl" role="dialog" aria-label="Recuperar mensagens de todos os grupos">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold">Recuperar mensagens de todos os grupos</p>
        <Badge tone="warning">Experimental</Badge>
        <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs text-ink-2">
        Pede ao celular conectado, grupo por grupo, as mensagens do período que não foram guardadas. O worker faz um grupo de cada vez e pode levar horas se a empresa tem muitos grupos; o celular
        precisa ficar ligado e com internet. Volta só como histórico (sem alertas nem respostas automáticas) e sem arquivos. Se o celular parar de responder, os demais grupos desse número são
        encerrados com o motivo, e dá para pedir de novo depois.
      </p>

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : (
        <>
          {status && progress && (
            <div className="mb-3 space-y-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={open ? 'warning' : 'good'}>{open ? 'Em andamento' : 'Terminado'}</Badge>
                <span className="text-muted">últimos {status.days} dia(s)</span>
                {open && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-hidden />}
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Andamento">
                <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${progress.percent}%` }} />
              </div>
              <p className="tabular text-ink">
                {formatNumber(progress.finished)} de {formatNumber(status.total)} grupos ({progress.percent}%) · {formatNumber(status.added)} mensagens novas em {formatNumber(status.groupsWithNews)} grupo(s)
              </p>
              <p className="tabular text-muted">
                {formatNumber(status.done)} concluídos · {formatNumber(status.failed)} com falha · {formatNumber(status.cancelled)} cancelados · {formatNumber(status.running)} rodando · {formatNumber(status.pending)} na fila
              </p>
              {status.failedNotes.length > 0 && (
                <ul className="space-y-0.5 text-ink-2">
                  {status.failedNotes.map((f, i) => (
                    <li key={i}>
                      <span className="tabular font-medium text-ink">{formatNumber(f.n)}×</span> {f.note ?? 'sem motivo registrado'}
                    </li>
                  ))}
                </ul>
              )}
              {open && (
                <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
                  Cancelar tudo
                </Button>
              )}
            </div>
          )}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-ink-2">
                Período
                <select
                  value={days}
                  onChange={(e) => onDays(Number(e.target.value))}
                  disabled={busy || open}
                  className="h-9 rounded-xl border border-line bg-surface px-2 text-[12px] text-ink outline-none focus:border-brand-line disabled:opacity-50"
                  aria-label="Período a recuperar"
                >
                  {DAY_OPTIONS.map((d) => (
                    <option key={d} value={d}>
                      últimos {d} dia{d > 1 ? 's' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" onClick={onStart} disabled={busy || open}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} Recuperar de todos
              </Button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" checked={onlyUnmonitored} onChange={(e) => onOnlyUnmonitored(e.target.checked)} disabled={busy || open} />
              Só os grupos sem monitoramento
            </label>
          </div>
        </>
      )}
    </div>
  );
}

/** Botão "Recuperar mensagens de todos" da lista de grupos (só o administrador geral da plataforma). */
export function HistoryRecoveryAllButton({ activeGroups }: { activeGroups: number }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [onlyUnmonitored, setOnlyUnmonitored] = useState(false);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const isOpen = useRef(false);

  const apply = (res: Awaited<ReturnType<typeof historyRecoveryBatchStatus>>, quiet: boolean) => {
    if (!quiet) setLoading(false);
    if (!res.ok) return void (quiet || toast.error(res.error));
    setStatus(res.status);
    isOpen.current = res.status ? batchOpen(res.status) : false;
  };
  const refresh = async () => apply(await historyRecoveryBatchStatus(), true);

  // abre: busca o lote mais recente; enquanto houver grupos em andamento, confere a cada 5 s
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void historyRecoveryBatchStatus().then((res) => alive && apply(res, false));
    const timer = setInterval(() => {
      if (alive && isOpen.current) void historyRecoveryBatchStatus().then((res) => alive && apply(res, true));
    }, 5000);
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
  }, [open]);

  const start = async () => {
    const scope = onlyUnmonitored ? 'os grupos sem monitoramento' : `os ${activeGroups} grupos ativos`;
    if (!confirm(`Pedir a recuperação das mensagens dos últimos ${days} dia(s) de ${scope}? O worker faz um grupo de cada vez e pode levar horas.`)) return;
    setBusy(true);
    try {
      const res = await startHistoryRecoveryAll(days, onlyUnmonitored);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.created ?? 0} grupo(s) na fila`, { description: res.skipped ? `${res.skipped} já tinham um pedido em andamento.` : undefined });
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!status || !confirm('Cancelar o que ainda não terminou? Os grupos já concluídos continuam como estão.')) return;
    setBusy(true);
    try {
      const res = await cancelHistoryRecoveryBatch(status.batchId);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${res.cancelled ?? 0} pedido(s) cancelado(s)`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          if (!open) setLoading(true);
          setOpen(!open);
        }}
        aria-expanded={open}
        title="Recuperar as mensagens que não foram guardadas, em todos os grupos (experimental)"
      >
        <History className="h-3.5 w-3.5" /> Recuperar mensagens de todos
      </Button>
      {open && (
        <div className="absolute right-0 top-10 z-30">
          <HistoryRecoveryAllPanel
            status={status}
            loading={loading}
            busy={busy}
            days={days}
            onDays={setDays}
            onlyUnmonitored={onlyUnmonitored}
            onOnlyUnmonitored={setOnlyUnmonitored}
            onStart={() => void start()}
            onCancel={() => void cancel()}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
