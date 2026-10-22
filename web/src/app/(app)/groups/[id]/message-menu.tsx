'use client';

import { EyeOff, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { requestMessageAction } from '../../actions';
import { Button, Textarea } from '@/components/ui';
import type { Message } from '@/lib/types';

const EDIT_MS = 15 * 60_000;
const DELETE_MS = 2 * 86_400_000;

/**
 * Menu "⋮" de uma mensagem do número conectado: editar (até 15 min), apagar para mim (só no número
 * conectado, sem prazo) e apagar para todos (até 2 dias),
 * como no WhatsApp. O pedido vai para o worker, que faz no WhatsApp; a conversa atualiza sozinha.
 */
export function MessageMenu({ message: m, onEdit }: { message: Message; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
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

  // os limites são conferidos ao abrir o menu (o banco confere de novo)
  const [limits, setLimits] = useState({ edit: false, del: false });
  // perto do fim da área da conversa, o menu abre para cima (senão fica cortado)
  const [up, setUp] = useState(false);
  const toggle = () => {
    const btn = ref.current?.getBoundingClientRect();
    const area = ref.current?.closest('.overflow-y-auto')?.getBoundingClientRect();
    setUp(Boolean(btn && btn.bottom + 140 > (area ? area.bottom : window.innerHeight)));
    const age = Date.now() - new Date(m.sent_at).getTime();
    setLimits({ edit: !m.deleted_at && m.message_type === 'text' && age < EDIT_MS, del: !m.deleted_at && age < DELETE_MS });
    setOpen((o) => !o);
  };

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
        <div role="menu" className={`absolute right-0 z-30 w-52 ${up ? 'bottom-full mb-1' : 'top-full mt-1'} overflow-hidden rounded-xl border border-line bg-surface py-1 text-sm shadow-lg`}>
          <button
            type="button"
            role="menuitem"
            disabled={!limits.edit}
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            title={limits.edit ? undefined : 'O WhatsApp só permite editar mensagens de texto até 15 minutos depois do envio'}
          >
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              if (!confirm('Apagar esta mensagem só para o número conectado?\n\nEla some do celular conectado e desta conversa; quem está no grupo continua vendo.')) return;
              start(async () => {
                const res = await requestMessageAction(m.id, 'delete_me');
                if (!res.ok) return void toast.error(res.error);
                toast.success('Apagando para mim…', { description: 'Some da conversa quando o WhatsApp confirmar.' });
              });
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2"
          >
            <EyeOff className="h-3.5 w-3.5" /> Apagar para mim
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!limits.del}
            onClick={() => {
              setOpen(false);
              if (!confirm('Apagar esta mensagem para todos no grupo?')) return;
              start(async () => {
                const res = await requestMessageAction(m.id, 'delete');
                if (!res.ok) return void toast.error(res.error);
                toast.success('Apagando para todos…', { description: 'A conversa atualiza quando o WhatsApp confirmar.' });
              });
            }}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-critical-ink hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
            title={limits.del ? undefined : 'O WhatsApp só permite apagar para todos até 2 dias depois do envio'}
          >
            <Trash2 className="h-3.5 w-3.5" /> Apagar para todos
          </button>
        </div>
      )}
    </div>
  );
}

/** Edição no próprio balão (Enter salva, Esc cancela). */
export function MessageEditor({ message: m, initial, onClose }: { message: Message; initial: string; onClose: () => void }) {
  const [text, setText] = useState(initial);
  const [pending, start] = useTransition();
  const save = () => {
    const body = text.trim();
    if (!body || body === initial.trim()) return onClose();
    start(async () => {
      const res = await requestMessageAction(m.id, 'edit', body);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Editando no WhatsApp…', { description: 'A conversa atualiza quando o WhatsApp confirmar.' });
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
