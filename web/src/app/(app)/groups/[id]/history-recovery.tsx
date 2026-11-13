'use client';

import { History, Loader2, RefreshCw, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button } from '@/components/ui';
import { cn, formatDateTime } from '@/lib/format';
import { DAY_OPTIONS, DEFAULT_DAYS, isOpen, STATUS_LABEL, summary } from '@/lib/history-recovery';
import { diagnose, recoveryLimitText, type ReceiveDiagnosis } from '@/lib/receive-diagnosis';
import { cancelHistoryRecovery, groupReceiveDiagnosis, latestHistoryRecovery, startHistoryRecovery, syncGroupCopies, type HistoryRequestView } from '../history-actions';

/** Janela da recuperação (só apresentação: quem busca e grava é o HistoryRecoveryButton). */
export function HistoryRecoveryPanel({
  request,
  loading,
  busy,
  days,
  onDays,
  onStart,
  onCancel,
  onClose,
  timeZone,
  diagnosis,
  diagnosedAt = 0,
  kind = 'group',
}: {
  /** onde se recupera: o texto muda (grupo ou conversa privada) */
  kind?: 'group' | 'private';
  request: HistoryRequestView | null;
  /** diagnóstico do recebimento (0165); undefined = carregando, null = indisponível */
  diagnosis?: ReceiveDiagnosis | null;
  /** quando o diagnóstico chegou (ms), base para "há quanto tempo" */
  diagnosedAt?: number;

  loading: boolean;
  busy: boolean;
  days: number;
  onDays: (days: number) => void;
  onStart: () => void;
  onCancel: () => void;
  onClose: () => void;
  timeZone?: string;
}) {
  const fmt = (iso: string) => formatDateTime(iso, timeZone);
  const findings = diagnosis ? diagnose(diagnosis, diagnosedAt, fmt) : [];
  const open = request ? isOpen(request.status) : false;
  const tone = !request ? 'neutral' : request.status === 'done' ? 'good' : request.status === 'failed' ? 'critical' : request.status === 'cancelled' ? 'neutral' : 'warning';
  return (
    <div className="w-[24rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-4 text-left shadow-xl" role="dialog" aria-label="Recuperar mensagens antigas">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-sm font-semibold">Recuperar mensagens antigas</p>
        <Badge tone="warning">Experimental</Badge>
        <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="mb-3 text-xs text-ink-2">
        Pede ao celular conectado as mensagens do período que não foram guardadas (por exemplo, enquanto {kind === 'private' ? 'a conversa estava sem monitoramento' : 'o grupo estava sem monitoramento'}). O celular precisa estar ligado e com internet. As
        mensagens voltam só como histórico: não geram alertas nem respostas automáticas. Arquivos (imagens, áudios) não são recuperados.
      </p>
      {diagnosis && <p className="mb-3 rounded-xl bg-warning/10 px-3 py-2 text-xs text-warning-ink">{recoveryLimitText(diagnosis.group.last_message_at, fmt)}</p>}
      {findings.length > 0 && (
        <div className="mb-3 space-y-1.5 rounded-xl border border-line px-3 py-2 text-xs" aria-label="Recebimento deste grupo">
          <p className="font-semibold text-ink">Recebimento deste grupo</p>
          {findings.map((f, i) => (
            <p key={i} className="flex gap-1.5">
              <span
                className={cn(
                  'mt-1 h-2 w-2 shrink-0 rounded-full',
                  f.tone === 'good' ? 'bg-good' : f.tone === 'critical' ? 'bg-critical' : f.tone === 'warning' ? 'bg-warning' : 'bg-muted',
                )}
                aria-hidden
              />
              <span className="text-ink-2">{f.text}</span>
            </p>
          ))}

        </div>
      )}

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </p>
      ) : (
        <>
          {request && (
            <div className="mb-3 space-y-1 rounded-xl border border-line bg-surface-2 px-3 py-2 text-xs" aria-live="polite">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={tone}>{STATUS_LABEL[request.status]}</Badge>
                <span className="text-muted">últimos {request.days} dia(s)</span>
                {request.status === 'running' && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" aria-hidden />}
              </div>
              <p className="tabular text-ink">{summary({ added: request.added, found: request.found, requests: request.requests })}</p>
              {request.oldestAt && <p className="text-muted">Chegou até {formatDateTime(request.oldestAt, timeZone)}</p>}
              {request.note && <p className="text-ink-2">{request.note}</p>}
              {open && (
                <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
                  Cancelar
                </Button>
              )}
            </div>
          )}
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
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />} Recuperar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/** Botão "Recuperar mensagens" da conversa do grupo (só o administrador geral da plataforma): abre a janela e acompanha o pedido. */
export function HistoryRecoveryButton({ groupId, timeZone }: { groupId: string; timeZone?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [request, setRequest] = useState<HistoryRequestView | null>(null);
  const [diagnosis, setDiagnosis] = useState<{ data: ReceiveDiagnosis | null; at: number }>({ data: null, at: 0 });
  const box = useRef<HTMLDivElement>(null);
  const lastStatus = useRef<string | null>(null);

  /** Aplica o pedido mais recente que chegou do servidor (e atualiza a conversa quando acabou trazendo mensagens). */
  const apply = (res: Awaited<ReturnType<typeof latestHistoryRecovery>>, quiet: boolean) => {
    if (!quiet) setLoading(false);
    if (!res.ok) return void (quiet || toast.error(res.error));
    setRequest(res.request);
    // concluiu trazendo mensagens novas: mostra na conversa
    const was = lastStatus.current;
    const done = res.request && res.request.status !== 'pending' && res.request.status !== 'running';
    if (done && (was === 'running' || was === 'pending') && res.request!.added > 0) router.refresh();
    lastStatus.current = res.request?.status ?? null;
  };
  const refresh = async () => apply(await latestHistoryRecovery(groupId), true);

  // abre: busca o pedido mais recente; enquanto ele estiver em andamento, confere a cada 4 s
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void latestHistoryRecovery(groupId).then((res) => alive && apply(res, false));
    void groupReceiveDiagnosis(groupId).then((res) => alive && res.ok && setDiagnosis({ data: res.diagnosis, at: Date.now() }));
    const timer = setInterval(() => {
      if (alive && (lastStatus.current === 'pending' || lastStatus.current === 'running')) {
        void latestHistoryRecovery(groupId).then((res) => alive && apply(res, true));
      }
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
  }, [open, groupId]);

  const start = async () => {
    setBusy(true);
    try {
      const res = await startHistoryRecovery(groupId, days);
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
      const res = await cancelHistoryRecovery(request.id);
      if (!res.ok) return void toast.error(res.error);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          if (!open) setLoading(true);
          setOpen(!open);
        }}
        aria-expanded={open}
        title="Recuperar mensagens que não foram guardadas (experimental)"
      >
        <History className="h-3.5 w-3.5" /> Recuperar mensagens
      </Button>
      {open && (
        <div className="absolute right-0 top-9 z-30">
          <HistoryRecoveryPanel
            request={request}
            loading={loading}
            busy={busy}
            days={days}
            onDays={setDays}
            onStart={() => void start()}
            onCancel={() => void cancel()}
            onClose={() => setOpen(false)}
            timeZone={timeZone}
            diagnosis={diagnosis.data}
            diagnosedAt={diagnosis.at}
          />
        </div>
      )}
    </div>
  );
}

/**
 * "Sincronizar setores" (0166, só administradores): traz agora, das cópias deste grupo em outros números (outros
 * setores), as mensagens que esta não tem. O worker já faz isso de minuto em minuto; o botão é para não esperar.
 */
export function GroupCopiesSyncButton({ groupId, copies }: { groupId: string; copies: number }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState(false);
  const none = copies === 0;
  const sync = async () => {
    setSyncing(true);
    try {
      const res = await syncGroupCopies(groupId);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.added ? `${res.added} mensagem(ns) trazida(s) da outra cópia do grupo` : 'Nada a trazer: as cópias já estão iguais');
      if (res.added) router.refresh();
    } finally {
      setSyncing(false);
    }
  };
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() => void sync()}
      disabled={syncing || none}
      title={
        none
          ? 'Este grupo está em um só número conectado: não há outra cópia (outro setor) para sincronizar'
          : `Trazer agora as mensagens que a cópia deste grupo em outro número (outro setor) recebeu e esta não (${copies} cópia${copies > 1 ? 's' : ''})`
      }
    >
      {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Sincronizar setores
    </Button>
  );
}
