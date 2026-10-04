'use client';

import { AlertCircle, Check, Clock, Loader2, Lock, RotateCcw, SendHorizontal, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { cn, formatPhone } from '@/lib/format';
import type { Message, OutgoingMessage } from '@/lib/types';
import { discardGroupMessage, retryGroupMessage, sendGroupMessage } from '../../actions';

export type ReplyConfig = {
  enabled: boolean;
  /** por que não dá para responder (função desligada, sem permissão, grupo não monitorado) */
  disabledReason: string | null;
  signName: boolean;
  userName: string;
};

const MAX = 4000;

const quoteLabel = (m: Message) => m.sender_name || formatPhone(m.sender_phone) || (m.from_me ? 'Número conectado' : 'Cliente');

/** Caixa de resposta: a mensagem vai para a fila e o worker envia pelo número conectado. */
export function Composer({
  groupId,
  config,
  replyTo,
  onClearReply,
}: {
  groupId: string;
  config: ReplyConfig;
  replyTo: Message | null;
  onClearReply: () => void;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);

  if (!config.enabled) {
    if (!config.disabledReason) return null;
    return (
      <p className="flex items-center gap-2 border-t border-line px-4 py-3 text-xs text-muted sm:px-5">
        <Lock className="h-3.5 w-3.5 shrink-0" /> {config.disabledReason}
      </p>
    );
  }

  const send = () => {
    const body = text.trim();
    if (!body || pending) return;
    start(async () => {
      const res = await sendGroupMessage(groupId, body, replyTo?.id ?? null);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setText('');
      onClearReply();
      router.refresh();
      ref.current?.focus();
    });
  };

  return (
    <div className="border-t border-line p-3 sm:px-5">
      {replyTo && (
        <div className="mb-2 flex items-start gap-2 rounded-xl border-l-4 border-series-1 bg-surface-2 px-3 py-2 text-xs">
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-series-1">Respondendo a {quoteLabel(replyTo)}</p>
            <p className="truncate text-ink-2">{replyTo.body ?? `[${replyTo.message_type}]`}</p>
          </div>
          <button onClick={onClearReply} className="rounded p-0.5 text-muted hover:text-ink" aria-label="Cancelar resposta citada">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX))}
          onKeyDown={(e) => {
            // Enter envia; Shift+Enter quebra a linha
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          rows={Math.min(6, Math.max(1, text.split('\n').length))}
          placeholder="Mensagem para o grupo…"
          aria-label="Mensagem para o grupo"
          disabled={pending}
          className="max-h-40 min-h-11 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand-soft sm:text-sm"
        />
        <button
          onClick={send}
          disabled={pending || !text.trim()}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink transition hover:opacity-90 disabled:opacity-40"
          aria-label="Enviar"
          title="Enviar (Enter)"
        >
          {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted">
        Sai pelo número conectado e aparece também no celular
        {config.signName ? ` · assinada como *${config.userName}:*` : ''} · Enter envia, Shift+Enter quebra a linha
      </p>
    </div>
  );
}

const STATUS = {
  pending: { icon: Clock, label: 'Na fila de envio', cls: 'text-muted' },
  sending: { icon: Loader2, label: 'Enviando…', cls: 'text-muted' },
  sent: { icon: Check, label: 'Enviada', cls: 'text-good-ink' },
  failed: { icon: AlertCircle, label: 'Não enviada', cls: 'text-critical-ink' },
} as const;

/** Resposta do painel que ainda não voltou pelo WhatsApp (na fila, enviando ou com falha). */
export function OutgoingBubble({ item, quoted }: { item: OutgoingMessage; quoted?: Message }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const s = STATUS[item.status];
  const run = (action: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await action();
      if (!res.ok) toast.error(res.error);
      router.refresh();
    });

  return (
    <div className="flex justify-end">
      <div
        className={cn(
          'max-w-[88%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm shadow-sm sm:max-w-[80%]',
          item.status === 'failed' ? 'border border-critical/40 bg-critical/5' : 'bg-brand-soft/60',
        )}
      >
        <p className="mb-0.5 text-xs font-semibold text-brand">{item.sender_name}</p>
        {quoted && (
          <p className="mb-1 truncate rounded-lg border-l-4 border-series-1 bg-surface/70 px-2 py-1 text-xs text-ink-2">
            {quoted.body ?? `[${quoted.message_type}]`}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words text-ink">{item.body}</p>
        <div className={cn('mt-1 flex items-center justify-end gap-1 text-[11px]', s.cls)}>
          <s.icon className={cn('h-3 w-3', item.status === 'sending' && 'animate-spin')} aria-hidden />
          {s.label}
        </div>
        {item.status === 'failed' && (
          <div className="mt-1 border-t border-critical/20 pt-1.5">
            {item.error && <p className="text-[11px] text-critical-ink">{item.error}</p>}
            <div className="mt-1 flex justify-end gap-1">
              <button
                onClick={() => run(() => retryGroupMessage(item.id))}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink hover:bg-surface"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Tentar de novo
              </button>
              <button
                onClick={() => run(() => discardGroupMessage(item.id))}
                disabled={pending}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface hover:text-critical-ink"
              >
                <Trash2 className="h-3.5 w-3.5" /> Descartar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
