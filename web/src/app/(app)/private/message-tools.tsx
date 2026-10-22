'use client';

import { Download, EyeOff, FileText, MoreVertical, Pencil, SmilePlus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Lightbox } from '../groups/[id]/message-media';
import { Button, Textarea } from '@/components/ui';
import { cn } from '@/lib/format';
import { requestPrivateAction } from './actions';

export type PrivateMessageRow = {
  id: string;
  chat_id: string;
  wa_message_id: string;
  from_me: boolean;
  sender_name: string | null;
  message_type: string;
  body: string | null;
  sent_at: string;
  wa_status: number | null;
  media_path?: string | null;
  media_size?: number | null;
  media_status?: string | null;
  edited_at?: string | null;
  original_body?: string | null;
  deleted_at?: string | null;
  hidden_at?: string | null;
};
export type PrivateReaction = { id: string; message_id: string; reactor_jid: string; from_me: boolean; emoji: string };

const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const EDIT_MS = 15 * 60_000;
const DELETE_MS = 2 * 86_400_000;

const formatSize = (bytes: number | null | undefined) =>
  bytes == null ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Imagem, figurinha, áudio, vídeo ou documento guardado da mensagem privada. */
export function PrivateMedia({ message: m }: { message: PrivateMessageRow }) {
  const [zoom, setZoom] = useState(false);
  const [broken, setBroken] = useState(false);
  if (!m.media_path) {
    const note =
      m.media_status === 'too_large'
        ? `Arquivo grande demais para guardar${m.media_size ? ` (${formatSize(m.media_size)})` : ''}. Veja no celular.`
        : m.media_status === 'failed'
          ? 'Não foi possível baixar o arquivo do WhatsApp. Veja no celular.'
          : m.media_status === 'expired'
            ? 'Arquivo apagado pelo prazo de guarda.'
            : null;
    return note ? <p className="mb-1 text-xs italic text-muted">{note}</p> : null;
  }
  if (broken) return <p className="mb-1 text-xs italic text-muted">Não foi possível abrir o arquivo.</p>;
  const src = `/private-media/${m.id}`;
  if (m.message_type === 'image' || m.message_type === 'sticker') {
    const sticker = m.message_type === 'sticker';
    return (
      <>
        <button type="button" onClick={() => setZoom(true)} className="mb-1 block overflow-hidden rounded-xl" title="Ampliar">
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado por link temporário */}
          <img
            src={src}
            alt={sticker ? 'Figurinha' : m.body || 'Imagem'}
            loading="lazy"
            onError={() => setBroken(true)}
            className={sticker ? 'h-28 w-28 object-contain' : 'max-h-72 w-auto max-w-full object-cover'}
          />
        </button>
        {zoom && <Lightbox src={src} alt={m.body || 'Imagem'} onClose={() => setZoom(false)} />}
      </>
    );
  }
  if (m.message_type === 'audio') {
    return <audio controls preload="none" src={src} onError={() => setBroken(true)} className="mb-1 h-10 w-72 max-w-full" aria-label="Áudio" />;
  }
  if (m.message_type === 'video') {
    return <video controls preload="metadata" src={src} onError={() => setBroken(true)} className="mb-1 max-h-72 max-w-full rounded-xl bg-black" />;
  }
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <FileText className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">
        {m.body || 'Documento'} <span className="text-xs text-muted">{formatSize(m.media_size)}</span>
      </span>
      <a href={src} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-text hover:underline">
        Abrir
      </a>
      <a href={`${src}?download=1`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-text hover:underline">
        <Download className="h-3.5 w-3.5" /> Baixar
      </a>
    </div>
  );
}

/** Reações embaixo do balão, agrupadas por emoji. */
export function PrivateReactions({ list, alignEnd }: { list: PrivateReaction[]; alignEnd: boolean }) {
  if (!list.length) return null;
  const byEmoji = new Map<string, PrivateReaction[]>();
  for (const r of list) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r]);
  return (
    <div className={cn('-mt-1.5 flex flex-wrap gap-1 px-2', alignEnd ? 'justify-end' : 'justify-start')} aria-label="Reações">
      {[...byEmoji].map(([emoji, rs]) => (
        <span
          key={emoji}
          title={rs.map((r) => (r.from_me ? 'Você' : 'Contato')).join(', ')}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-0.5 text-xs shadow-sm"
        >
          {emoji}
          {rs.length > 1 && <span className="tabular text-[10px] font-semibold text-ink-2">{rs.length}</span>}
        </span>
      ))}
    </div>
  );
}

/**
 * Menu "⋮" da mensagem: reagir, editar (até 15 min, só as do número conectado), apagar para mim
 * e apagar para todos (até 2 dias, só as do número conectado). O worker faz no WhatsApp.
 */
export function PrivateMessageMenu({ message: m, myReaction, onEdit }: { message: PrivateMessageRow; myReaction: string | null; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const [limits, setLimits] = useState({ edit: false, del: false });
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const toggle = () => {
    const btn = ref.current?.getBoundingClientRect();
    const area = ref.current?.closest('.overflow-y-auto')?.getBoundingClientRect();
    setUp(Boolean(btn && btn.bottom + 200 > (area ? area.bottom : window.innerHeight)));
    const age = Date.now() - new Date(m.sent_at).getTime();
    setLimits({
      edit: m.from_me && !m.deleted_at && m.message_type === 'text' && age < EDIT_MS,
      del: m.from_me && !m.deleted_at && age < DELETE_MS,
    });
    setOpen((o) => !o);
  };
  const run = (action: 'delete' | 'delete_me' | 'react', ok: string, extra?: { emoji?: string }) =>
    start(async () => {
      setOpen(false);
      const res = await requestPrivateAction(m.id, action, extra);
      if (!res.ok) return void toast.error(res.error);
      toast.success(ok, { description: 'A conversa atualiza quando o WhatsApp confirmar.' });
    });

  const item = 'flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Opções da mensagem"
        className="rounded-full p-0.5 text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <MoreVertical className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            'absolute z-30 w-56 overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-lg',
            m.from_me ? 'right-0' : 'left-0',
            up ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
        >
          {!m.deleted_at && (
            <div className="flex items-center gap-0.5 border-b border-line px-2 pb-1.5 pt-1" aria-label="Reagir">
              <SmilePlus className="mr-1 h-3.5 w-3.5 text-muted" aria-hidden />
              {QUICK.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="menuitem"
                  onClick={() => run('react', e === myReaction ? 'Reação retirada' : 'Reação enviada', { emoji: e === myReaction ? '' : e })}
                  className={cn('rounded-lg px-1 py-0.5 text-lg hover:bg-surface-2', e === myReaction && 'bg-brand-soft')}
                  aria-label={e === myReaction ? `Tirar a reação ${e}` : `Reagir com ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
          {m.from_me && (
            <button
              type="button"
              role="menuitem"
              disabled={!limits.edit}
              onClick={() => {
                setOpen(false);
                onEdit();
              }}
              className={item}
              title={limits.edit ? undefined : 'O WhatsApp só permite editar mensagens de texto até 15 minutos depois do envio'}
            >
              <Pencil className="h-3.5 w-3.5" /> Editar
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() =>
              confirm('Apagar esta mensagem só para o número conectado?\n\nEla some do celular conectado e daqui; a outra pessoa continua vendo.') &&
              run('delete_me', 'Apagando para mim…')
            }
            className={item}
          >
            <EyeOff className="h-3.5 w-3.5" /> Apagar para mim
          </button>
          {m.from_me && (
            <button
              type="button"
              role="menuitem"
              disabled={!limits.del}
              onClick={() => confirm('Apagar esta mensagem para todos?') && run('delete', 'Apagando para todos…')}
              className={cn(item, 'text-critical-ink')}
              title={limits.del ? undefined : 'O WhatsApp só permite apagar para todos até 2 dias depois do envio'}
            >
              <Trash2 className="h-3.5 w-3.5" /> Apagar para todos
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Edição no próprio balão (Enter salva, Esc cancela). */
export function PrivateEditor({ message: m, onClose }: { message: PrivateMessageRow; onClose: () => void }) {
  const [text, setText] = useState(m.body ?? '');
  const [pending, start] = useTransition();
  const save = () => {
    const body = text.trim();
    if (!body || body === (m.body ?? '').trim()) return onClose();
    start(async () => {
      const res = await requestPrivateAction(m.id, 'edit', { body });
      if (!res.ok) return void toast.error(res.error);
      toast.success('Editando no WhatsApp…');
      onClose();
    });
  };
  return (
    <div className="mt-1 space-y-2">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(6, Math.max(2, text.split('\n').length))}
        autoFocus
        maxLength={4000}
        aria-label="Editar mensagem"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            save();
          }
        }}
        className="min-w-[16rem] text-sm"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar'}
        </Button>
      </div>
    </div>
  );
}
