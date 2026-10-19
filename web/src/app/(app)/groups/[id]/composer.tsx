'use client';

import { AlertCircle, Check, CheckCircle2, Clock, Loader2, Lock, RotateCcw, SendHorizontal, Trash2, X, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { cn, formatPhone } from '@/lib/format';
import { findShortcutTrigger, greeting, matchQuickReplies, renderQuickReply, type QuickReply } from '@/lib/quick-replies';
import type { Message, OutgoingMessage } from '@/lib/types';
import { discardGroupMessage, retryGroupMessage, sendGroupMessage } from '../../actions';

export type ReplyConfig = {
  enabled: boolean;
  /** por que não dá para responder (função desligada, sem permissão, grupo não monitorado) */
  disabledReason: string | null;
  signName: boolean;
  userName: string;
  /** mensagens rápidas da empresa (\atalho na caixa de resposta) */
  quickReplies?: QuickReply[];
  groupName?: string;
  /** atalho da mensagem rápida que encerra a conversa */
  closingShortcut?: string;
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
  // mensagens rápidas: "\" + atalho antes do cursor abre a lista
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // a resposta usou a mensagem de fechamento: ao enviar, a conversa do grupo é encerrada
  const [closing, setClosing] = useState(false);
  const closingShortcut = config.closingShortcut || 'fechamento';
  const quick = useMemo(() => config.quickReplies ?? [], [config.quickReplies]);
  const options = useMemo(() => (trigger ? matchQuickReplies(quick, trigger.query) : []), [quick, trigger]);
  const open = Boolean(trigger) && quick.length > 0;

  const detect = (value: string, caret: number) => {
    const t = findShortcutTrigger(value, caret);
    setTrigger(t);
    if (!t || t.query !== trigger?.query) setActive(0);
  };

  const insertQuick = (r: QuickReply) => {
    const el = ref.current;
    if (!trigger) return;
    const caret = el?.selectionStart ?? text.length;
    const before = text.slice(0, trigger.start);
    const atSentenceStart = !before.trim() || /[.!?\n]\s*$/.test(before);
    const hello = greeting();
    const body = renderQuickReply(r.body, {
      saudacao: atSentenceStart ? hello.charAt(0).toUpperCase() + hello.slice(1) : hello,
      cliente: replyTo && !replyTo.from_team ? replyTo.sender_name || null : null,
      grupo: config.groupName ?? null,
      atendente: config.userName,
    });
    const next = (before + body + text.slice(caret)).slice(0, MAX);
    setText(next);
    setTrigger(null);
    if (r.shortcut === closingShortcut) setClosing(true);
    const pos = Math.min(MAX, before.length + body.length);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

  const openList = () => {
    const el = ref.current;
    const caret = el?.selectionStart ?? text.length;
    const needsSpace = caret > 0 && !/\s/.test(text[caret - 1]);
    const next = `${text.slice(0, caret)}${needsSpace ? ' ' : ''}\\${text.slice(caret)}`;
    setText(next);
    const pos = caret + (needsSpace ? 2 : 1);
    setTrigger({ start: pos - 1, query: '' });
    setActive(0);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
  };

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
      const res = await sendGroupMessage(groupId, body, replyTo?.id ?? null, closing);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (closing) toast.success('Conversa encerrada', { description: 'A próxima mensagem do cliente inicia uma nova conversa.' });
      setClosing(false);
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
      {closing && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-good/40 bg-good/10 px-3 py-1.5 text-xs text-good-ink">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            Esta resposta <strong>encerra a conversa</strong> (\{closingShortcut}). A próxima mensagem do cliente inicia uma nova.
          </span>
          <button
            type="button"
            onClick={() => setClosing(false)}
            className="rounded p-0.5 hover:text-ink"
            aria-label="Não encerrar a conversa"
            title="Enviar sem encerrar a conversa"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <div className="relative flex items-end gap-2">
        {open && (
          <div
            className="absolute bottom-full left-0 right-14 z-20 mb-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
            role="listbox"
            aria-label="Mensagens rápidas"
          >
            <p className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px] font-medium text-muted">
              <Zap className="h-3.5 w-3.5" /> Mensagens rápidas · ↑↓ escolhe · Enter insere · Esc fecha
            </p>
            {options.length === 0 ? (
              <p className="px-3 py-3 text-xs text-muted">Nenhuma mensagem rápida com “{trigger?.query}”.</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto py-1">
                {options.map((r, i) => (
                  <li key={r.id} role="option" aria-selected={i === active}>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertQuick(r);
                      }}
                      onMouseEnter={() => setActive(i)}
                      className={cn('flex w-full items-start gap-2 px-3 py-2 text-left', i === active && 'bg-brand-soft')}
                    >
                      <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-semibold text-brand-text">
                        \{r.shortcut}
                      </span>
                      <span className="min-w-0">
                        {r.title && <span className="block truncate text-xs font-medium text-ink">{r.title}</span>}
                        <span className="block truncate text-xs text-ink-2">{r.body}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => {
            const value = e.target.value.slice(0, MAX);
            setText(value);
            if (!value.trim()) setClosing(false);
            detect(value, e.target.selectionStart ?? value.length);
          }}
          onSelect={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
          onBlur={() => setTrigger(null)}
          onKeyDown={(e) => {
            if (open) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                if (options.length) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
                return;
              }
              if ((e.key === 'Enter' || e.key === 'Tab') && options.length) {
                e.preventDefault();
                insertQuick(options[Math.min(active, options.length - 1)]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setTrigger(null);
                return;
              }
            }
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
          className="max-h-40 min-h-11 w-full resize-none rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink outline-none transition placeholder:text-muted focus:border-brand-line focus:ring-2 focus:ring-brand-soft sm:text-sm"
        />
        {quick.length > 0 && (
          <button
            type="button"
            onClick={openList}
            disabled={pending}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink-2 transition hover:border-brand-line hover:text-brand-text disabled:opacity-40"
            aria-label="Mensagens rápidas"
            title="Mensagens rápidas (digite \ e o atalho)"
          >
            <Zap className="h-5 w-5" />
          </button>
        )}
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
        {quick.length > 0 ? ' · \\ + atalho insere uma mensagem rápida' : ''}
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
        <p className="mb-0.5 text-xs font-semibold text-brand-text">{item.sender_name}</p>
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
