'use client';

import { AlertCircle, Check, CheckCircle2, Clock, Loader2, Lock, Mic, Paperclip, RotateCcw, SendHorizontal, Trash2, X, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { VoiceRecorder, type VoiceClip } from '@/components/voice-recorder';
import { cn, formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import {
  applyMentions,
  filterMentionMembers,
  findMentionTrigger,
  mentionLabel,
  type MentionMember,
  type PickedMention,
} from '@/lib/mentions';
import { findShortcutTrigger, greeting, matchQuickReplies, renderQuickReply, type QuickReply } from '@/lib/quick-replies';
import type { Message, OutgoingMessage } from '@/lib/types';
import { discardGroupMessage, prepareGroupAudioUpload, prepareGroupUpload, retryGroupMessage, sendGroupMessage, type GroupFile } from '../../actions';

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
const MAX_FILE = 50 * 1024 * 1024;
/** quantos arquivos cabem numa vez */
const MAX_FILES = 10;
const sizeLabel = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const quoteLabel = (m: Message) => m.sender_name || formatPhone(m.sender_phone) || (m.from_me ? 'Número conectado' : 'Cliente');

/** Caixa de resposta: a mensagem vai para a fila e o worker envia pelo número conectado. */
export function Composer({
  groupId,
  config,
  replyTo,
  onClearReply,
  members = [],
}: {
  groupId: string;
  config: ReplyConfig;
  replyTo: Message | null;
  onClearReply: () => void;
  /** participantes do grupo: "@" abre a lista para marcar alguém */
  members?: MentionMember[];
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const ref = useRef<HTMLTextAreaElement>(null);
  // mensagens rápidas: "\" + atalho antes do cursor abre a lista
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);
  // menções: "@" antes do cursor abre a lista dos participantes do grupo
  const [mentionTrigger, setMentionTrigger] = useState<{ start: number; query: string } | null>(null);
  const [mentionActive, setMentionActive] = useState(0);
  // quem foi escolhido na lista (o "@Nome" que ficou no texto e a quem ele se refere)
  const [picked, setPicked] = useState<PickedMention[]>([]);
  // a resposta usou a mensagem de fechamento: ao enviar, a conversa do grupo é encerrada
  const [closing, setClosing] = useState(false);
  const [recording, setRecording] = useState(false);
  // arquivos anexados (imagem, vídeo, áudio ou documento), um ou vários: vão em sequência e o texto é a legenda do primeiro
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const addFiles = (list: ArrayLike<File> | null | undefined) => {
    const picked = Array.from(list ?? []);
    if (!picked.length) return;
    const fits = picked.filter((f) => f.size <= MAX_FILE);
    if (fits.length < picked.length) toast.error('Arquivo acima de 50 MB não foi anexado.');
    setFiles((prev) => {
      const next = [...prev, ...fits];
      if (next.length > MAX_FILES) toast.error(`No máximo ${MAX_FILES} arquivos por vez.`);
      return next.slice(0, MAX_FILES);
    });
  };
  const closingShortcut = config.closingShortcut || 'fechamento';
  const quick = useMemo(() => config.quickReplies ?? [], [config.quickReplies]);
  const options = useMemo(() => (trigger ? matchQuickReplies(quick, trigger.query) : []), [quick, trigger]);
  const open = Boolean(trigger) && quick.length > 0;
  const mentionOptions = useMemo(() => (mentionTrigger ? filterMentionMembers(members, mentionTrigger.query) : []), [members, mentionTrigger]);
  const mentionOpen = Boolean(mentionTrigger) && members.length > 0;

  const detect = (value: string, caret: number) => {
    const t = findShortcutTrigger(value, caret);
    setTrigger(t);
    if (!t || t.query !== trigger?.query) setActive(0);
    const mt = findMentionTrigger(value, caret);
    setMentionTrigger(mt);
    if (!mt || mt.query !== mentionTrigger?.query) setMentionActive(0);
  };

  /** Escolheu alguém na lista: o "@Nome" entra no texto no lugar do que foi digitado depois do "@". */
  const insertMention = (m: MentionMember) => {
    const el = ref.current;
    if (!mentionTrigger) return;
    const caret = el?.selectionStart ?? text.length;
    const token = `@${mentionLabel(m)}`;
    const next = (text.slice(0, mentionTrigger.start) + token + ' ' + text.slice(caret)).slice(0, MAX);
    setText(next);
    setPicked((prev) => [...prev, { token, jid: m.jid }]);
    setMentionTrigger(null);
    const pos = Math.min(MAX, mentionTrigger.start + token.length + 1);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos, pos);
    });
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
    const typed = text.trim();
    if ((!typed && !files.length) || pending) return;
    // "@Nome" vira "@número" e as pessoas marcadas vão na lista de menções da mensagem
    const { text: body, mentions } = applyMentions(typed, picked);
    const queue = [...files];
    start(async () => {
      if (!queue.length) {
        const res = await sendGroupMessage(groupId, body, replyTo?.id ?? null, closing, null, mentions);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        if (closing) toast.success('Conversa encerrada', { description: 'A próxima mensagem do cliente inicia uma nova conversa.' });
        setClosing(false);
        setText('');
        setPicked([]);
        onClearReply();
        router.refresh();
        ref.current?.focus();
        return;
      }
      // cada arquivo vai direto para o Storage (link de upload do grupo) e o worker envia, na ordem:
      // o texto e a citação ficam no primeiro; a mensagem que encerra a conversa, no último
      for (let i = 0; i < queue.length; i++) {
        const sending = queue[i];
        const first = i === 0;
        const mime = sending.type || 'application/octet-stream';
        const prep = await prepareGroupUpload(groupId, { name: sending.name, mime, size: sending.size });
        if (!prep.ok) {
          toast.error(prep.error);
          break;
        }
        const up = await createClient().storage.from('media').uploadToSignedUrl(prep.data.path, prep.data.token, sending, { contentType: mime });
        if (up.error) {
          toast.error('Não foi possível enviar o arquivo', { description: up.error.message });
          break;
        }
        const type = mime.startsWith('image/') && !mime.includes('svg') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
        const media: GroupFile = { path: prep.data.path, type, mime, name: sending.name, size: sending.size };
        const res = await sendGroupMessage(groupId, first ? body : '', first ? (replyTo?.id ?? null) : null, closing && i === queue.length - 1, media, first ? mentions : []);
        if (!res.ok) {
          toast.error(res.error);
          break;
        }
        if (first) {
          setText('');
          setPicked([]);
          onClearReply();
        }
        // o que já foi enviado sai da lista: se algo falhar, o resto continua para tentar de novo
        setFiles((prev) => prev.slice(1));
        if (closing && i === queue.length - 1) {
          toast.success('Conversa encerrada', { description: 'A próxima mensagem do cliente inicia uma nova conversa.' });
          setClosing(false);
        }
      }
      router.refresh();
      ref.current?.focus();
    });
  };

  // áudio gravado: sobe para o Storage (pasta do grupo) e o worker envia como mensagem de voz
  const sendVoice = async (clip: VoiceClip) => {
    const prep = await prepareGroupAudioUpload(groupId, { ext: clip.ext, size: clip.blob.size });
    if (!prep.ok) {
      toast.error(prep.error);
      return false;
    }
    const up = await createClient().storage.from('media').uploadToSignedUrl(prep.data.path, prep.data.token, clip.blob, { contentType: clip.mime });
    if (up.error) {
      toast.error('Não foi possível enviar o áudio', { description: up.error.message });
      return false;
    }
    const res = await sendGroupMessage(groupId, '', replyTo?.id ?? null, false, { path: prep.data.path, mime: clip.mime, size: clip.blob.size, voice: true });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    onClearReply();
    router.refresh();
    return true;
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
      {files.length > 0 && (
        <div className="mb-2 space-y-1">
          {files.map((f, i) => (
            <div key={`${f.name}-${f.size}-${f.lastModified}-${i}`} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-xs">
              <Paperclip className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">
                {f.name} <span className="text-muted">· {sizeLabel(f.size)}</span>
              </span>
              {i === 0 && <span className="shrink-0 text-muted">{text.trim() ? 'com legenda' : 'escreva uma legenda (opcional)'}</span>}
              <button
                type="button"
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                disabled={pending}
                className="rounded p-0.5 text-muted hover:text-ink"
                aria-label={`Tirar ${f.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {files.length > 1 && <p className="px-1 text-[9px] text-muted">Os {files.length} arquivos vão em mensagens separadas, na ordem; o texto é a legenda do primeiro.</p>}
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
      <div
        className="relative flex items-end gap-2"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        {mentionOpen && mentionOptions.length > 0 && (
          <div
            className="absolute bottom-full left-0 right-14 z-20 mb-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
            role="listbox"
            aria-label="Marcar alguém do grupo"
          >
            <p className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[9px] font-medium text-muted">
              @ Marcar alguém do grupo · ↑↓ escolhe · Enter insere · Esc fecha
            </p>
            <ul className="max-h-64 overflow-y-auto py-1">
              {mentionOptions.map((m, i) => (
                <li key={m.jid} role="option" aria-selected={i === mentionActive}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      insertMention(m);
                    }}
                    onMouseEnter={() => setMentionActive(i)}
                    className={cn('flex w-full items-center gap-2 px-3 py-2 text-left', i === mentionActive && 'bg-brand-soft')}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink-2" aria-hidden>
                      {mentionLabel(m).replace(/\D/g, '').length > 6 ? '@' : mentionLabel(m).charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-ink">{mentionLabel(m)}</span>
                      {m.phone && m.name && <span className="block truncate text-xs text-ink-2">{formatPhone(m.phone)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {open && (
          <div
            className="absolute bottom-full left-0 right-14 z-20 mb-2 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
            role="listbox"
            aria-label="Mensagens rápidas"
          >
            <p className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[9px] font-medium text-muted">
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
        {!recording && (
          <>
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={pending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line text-ink-2 transition hover:border-brand-line hover:text-brand-text disabled:opacity-40"
              aria-label="Anexar arquivo"
              title="Anexar imagem, vídeo, áudio ou documentos (até 50 MB cada, vários de uma vez)"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <textarea
              ref={ref}
              value={text}
              onChange={(e) => {
                const value = e.target.value.slice(0, MAX);
                setText(value);
                if (!value.trim()) {
                  setClosing(false);
                  setPicked([]);
                }
                detect(value, e.target.selectionStart ?? value.length);
              }}
              onSelect={(e) => detect(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
              onPaste={(e) => {
                // colar uma imagem (print) anexa o arquivo
                const pasted = [...(e.clipboardData?.files ?? [])];
                if (pasted.length) {
                  e.preventDefault();
                  addFiles(pasted);
                }
              }}
              onBlur={() => {
                setTrigger(null);
                setMentionTrigger(null);
              }}
              onKeyDown={(e) => {
                // lista de menções (@): setas escolhem, Enter ou Tab inserem, Esc fecha
                if (mentionOpen) {
                  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && mentionOptions.length) {
                    e.preventDefault();
                    setMentionActive((a) => (a + (e.key === 'ArrowDown' ? 1 : mentionOptions.length - 1)) % mentionOptions.length);
                    return;
                  }
                  if ((e.key === 'Enter' || e.key === 'Tab') && mentionOptions.length && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    insertMention(mentionOptions[Math.min(mentionActive, mentionOptions.length - 1)]);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionTrigger(null);
                    return;
                  }
                }
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
              placeholder={files.length ? 'Legenda (opcional)' : 'Mensagem para o grupo…'}
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
          </>
        )}
        {/* sem texto, o botão é o microfone (como no WhatsApp) */}
        {recording || (!text.trim() && !files.length) ? (
          <VoiceRecorder onSend={sendVoice} onActiveChange={setRecording} disabled={pending} />
        ) : (
          <button
            onClick={send}
            disabled={pending || (!text.trim() && !files.length)}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-brand-ink transition hover:opacity-90 disabled:opacity-40"
            aria-label="Enviar"
            title="Enviar (Enter)"
          >
            {pending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizontal className="h-5 w-5" />}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[9px] text-muted">
        Sai pelo número conectado e aparece também no celular
        {config.signName ? ` · assinada como *${config.userName}:*` : ''} · Enter envia, Shift+Enter quebra a linha · 📎 anexa um arquivo · 🎤 grava um áudio
        {quick.length > 0 ? ' · \\ + atalho insere uma mensagem rápida' : ''}
        {members.length > 0 ? ' · @ marca alguém do grupo' : ''}
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

const FILE_LABEL: Record<string, string> = { image: 'Imagem', video: 'Vídeo', document: 'Documento' };

/** Resposta do painel que ainda não voltou pelo WhatsApp (na fila, enviando ou com falha). */
export function OutgoingBubble({ item, quoted, renderText }: { item: OutgoingMessage; quoted?: Message; renderText?: (text: string) => ReactNode }) {
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
        {item.message_type === 'audio' ? (
          <p className="flex items-center gap-1.5 text-ink-2">
            <Mic className="h-4 w-4" /> Áudio
          </p>
        ) : (
          <>
            {item.message_type && item.message_type !== 'text' && (
              <p className="mb-0.5 flex items-center gap-1.5 text-ink-2">
                <Paperclip className="h-4 w-4 shrink-0" /> <span className="truncate">{item.media_name || FILE_LABEL[item.message_type] || 'Arquivo'}</span>
              </p>
            )}
            {item.body && <p className="whitespace-pre-wrap break-words text-ink">{renderText ? renderText(item.body) : item.body}</p>}
          </>
        )}
        <div className={cn('mt-1 flex items-center justify-end gap-1 text-[9px]', s.cls)}>
          <s.icon className={cn('h-3 w-3', item.status === 'sending' && 'animate-spin')} aria-hidden />
          {s.label}
        </div>
        {item.status === 'failed' && (
          <div className="mt-1 border-t border-critical/20 pt-1.5">
            {item.error && <p className="text-[9px] text-critical-ink">{item.error}</p>}
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
