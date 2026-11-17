'use client';

import { FileText, Image as ImageIcon, Loader2, Paperclip, Search, UserRound, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';

export type ContactToSend = { name: string; phone: string };
type DirectoryContact = { jid: string; phone: string | null; name: string | null; notify: string | null };

/**
 * Anexar na conversa, como no WhatsApp: Imagem (ou vídeo), Documento e Contato. Imagem e documento entregam os arquivos
 * escolhidos a quem chamou (o mesmo envio de arquivos de sempre); Contato abre a escolha de quem enviar (a lista de
 * contatos do sistema ou nome e telefone digitados) e entrega o cartão.
 */
export function AttachMenu({
  disabled,
  onFiles,
  onContact,
  className,
  iconClassName = 'h-5 w-5',
}: {
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
  onContact: (contact: ContactToSend) => void;
  className?: string;
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const docInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', esc);
    window.addEventListener('mousedown', outside);
    return () => {
      window.removeEventListener('keydown', esc);
      window.removeEventListener('mousedown', outside);
    };
  }, [open]);

  const item = 'flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm text-ink hover:bg-surface-2';
  const pick = (input: React.RefObject<HTMLInputElement | null>) => {
    setOpen(false);
    input.current?.click();
  };
  return (
    <div ref={box} className="relative">
      <input
        ref={imageInput}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={docInput}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="menu"
        className={className}
        aria-label="Anexar"
        title="Anexar imagem, documento ou contato (arquivos até 50 MB cada, vários de uma vez)"
      >
        <Paperclip className={iconClassName} />
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-30 mb-2 w-52 overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <button type="button" role="menuitem" className={item} onClick={() => pick(imageInput)}>
            <ImageIcon className="h-4 w-4 text-series-1" /> Imagem ou vídeo
          </button>
          <button type="button" role="menuitem" className={item} onClick={() => pick(docInput)}>
            <FileText className="h-4 w-4 text-brand-text" /> Documento
          </button>
          <button
            type="button"
            role="menuitem"
            className={item}
            onClick={() => {
              setOpen(false);
              setPicking(true);
            }}
          >
            <UserRound className="h-4 w-4 text-warning-ink" /> Contato
          </button>
        </div>
      )}
      {picking && (
        <ContactPicker
          onClose={() => setPicking(false)}
          onPick={(c) => {
            setPicking(false);
            onContact(c);
          }}
        />
      )}
    </div>
  );
}

function ContactPicker({ onClose, onPick }: { onClose: () => void; onPick: (c: ContactToSend) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<DirectoryContact[] | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // contatos do sistema (agenda do WhatsApp, conversas e equipe); a busca filtra por nome ou número
  useEffect(() => {
    let alive = true;
    const t = setTimeout(
      () => {
        void createClient()
          .rpc('contact_directory', { p_search: q.trim() || null, p_limit: 40 })
          .then(({ data, error }) => {
            if (alive) setList(error ? [] : ((data ?? []) as DirectoryContact[]));
          });
      },
      q.trim() ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  const canManual = name.trim().length > 0 && phone.replace(/\D/g, '').length >= 10;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Enviar contato">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-base font-semibold">Enviar contato</h2>
            <p className="text-xs text-ink-2">Escolha quem enviar ou digite o nome e o telefone.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contato por nome ou número" className="pl-9" aria-label="Buscar contato" autoFocus />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto border-y border-line">
          {list === null && (
            <li className="flex items-center justify-center gap-2 p-4 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </li>
          )}
          {list?.length === 0 && <li className="p-4 text-center text-sm text-muted">Nenhum contato encontrado. Digite o nome e o telefone abaixo.</li>}
          {list?.map((c) => {
            const label = c.name || c.notify || (c.phone ? formatPhone(c.phone) : 'Sem nome');
            return (
              <li key={c.jid}>
                <button
                  type="button"
                  disabled={!c.phone}
                  onClick={() => c.phone && onPick({ name: label, phone: c.phone })}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface-2 disabled:opacity-50"
                  title={c.phone ? undefined : 'Sem telefone conhecido: não dá para enviar como contato'}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-text">
                    <UserRound className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{label}</span>
                    <span className="block truncate text-xs text-muted">{c.phone ? formatPhone(c.phone) : 'sem telefone'}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <form
          className="space-y-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canManual) onPick({ name: name.trim(), phone: phone.trim() });
          }}
        >
          <p className="text-[9px] font-semibold uppercase tracking-wide text-muted">Ou digite</p>
          <div className="flex gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome" maxLength={100} aria-label="Nome do contato" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="51 99999-8888" inputMode="tel" aria-label="Telefone do contato" />
          </div>
          <Button type="submit" size="sm" disabled={!canManual}>
            Enviar contato
          </Button>
        </form>
      </div>
    </div>
  );
}
