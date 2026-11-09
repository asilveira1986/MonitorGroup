'use client';

import { BookmarkPlus, Loader2, Plus, Star, Sticker, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/format';
import { validateStickerFile } from '@/lib/stickers';
import { createClient } from '@/lib/supabase/client';
import {
  addSticker,
  deleteSticker,
  loadStickers,
  prepareStickerUpload,
  saveReceivedSticker,
  sendSticker,
  setStickerFavorite,
  type ReceivedSticker,
  type StickerItem,
} from '../../stickers/actions';

type Tab = 'library' | 'received';

/** Janela das figurinhas (só apresentação: quem busca e grava é o StickerButton). */
export function StickerPanel({
  library,
  received,
  loading,
  busy,
  canDelete,
  onSendLibrary,
  onSendReceived,
  onSaveReceived,
  onFavorite,
  onDelete,
  onUpload,
  onClose,
  initialTab = 'library',
}: {
  library: StickerItem[];
  received: ReceivedSticker[];
  loading: boolean;
  busy: boolean;
  canDelete: boolean;
  onSendLibrary: (id: string) => void;
  onSendReceived: (id: string) => void;
  onSaveReceived: (id: string) => void;
  onFavorite: (id: string, favorite: boolean) => void;
  onDelete: (id: string) => void;
  onUpload: (file: File) => void;
  onClose: () => void;
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const fileInput = useRef<HTMLInputElement>(null);
  const tabBtn = (k: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(k)}
      aria-pressed={tab === k}
      className={cn('rounded-lg px-3 py-1.5 text-xs font-medium', tab === k ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink')}
    >
      {label}
    </button>
  );
  const cell = 'group relative flex h-[4.5rem] w-full items-center justify-center rounded-xl bg-surface-2 p-1 transition hover:bg-brand-soft disabled:opacity-50';
  const tiny = 'absolute flex h-5 w-5 items-center justify-center rounded-full bg-surface/90 text-ink-2 shadow-sm hover:text-ink';

  return (
    <div className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-3 shadow-xl" role="dialog" aria-label="Figurinhas">
      <div className="mb-2 flex items-center gap-2">
        <div className="inline-flex rounded-xl border border-line p-1">
          {tabBtn('library', `Biblioteca (${library.length})`)}
          {tabBtn('received', `Recebidas (${received.length})`)}
        </div>
        <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar figurinhas">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-72 overflow-y-auto pr-0.5">
        {loading ? (
          <p className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </p>
        ) : tab === 'library' ? (
          library.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted">
              Nenhuma figurinha na biblioteca. Adicione um arquivo .webp ou salve uma da aba “Recebidas”. A biblioteca vale para toda a empresa.
            </p>
          ) : (
            <ul className="grid grid-cols-4 gap-2">
              {library.map((s) => (
                <li key={s.id} className="relative">
                  <button type="button" className={cell} disabled={busy} onClick={() => onSendLibrary(s.id)} title={s.name ? `Enviar: ${s.name}` : 'Enviar figurinha'} aria-label={s.name ? `Enviar figurinha ${s.name}` : 'Enviar figurinha'}>
                    {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado por link temporário */}
                    <img src={`/sticker/${s.id}`} alt={s.name ?? 'Figurinha'} loading="lazy" className="h-full w-full object-contain" />
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onFavorite(s.id, !s.favorite)}
                    className={cn(tiny, 'left-0.5 top-0.5', s.favorite && 'text-warning-ink')}
                    aria-label={s.favorite ? 'Tirar dos favoritos' : 'Marcar como favorita'}
                    aria-pressed={s.favorite}
                    title={s.favorite ? 'Favorita (aparece primeiro)' : 'Marcar como favorita'}
                  >
                    <Star className={cn('h-3 w-3', s.favorite && 'fill-current')} />
                  </button>
                  {canDelete && (
                    <button type="button" disabled={busy} onClick={() => onDelete(s.id)} className={cn(tiny, 'right-0.5 top-0.5 hover:text-critical-ink')} aria-label="Excluir da biblioteca" title="Excluir da biblioteca (só administradores)">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : received.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted">Nenhuma figurinha recebida neste grupo ainda.</p>
        ) : (
          <ul className="grid grid-cols-4 gap-2">
            {received.map((m) => (
              <li key={m.id} className="relative">
                <button type="button" className={cell} disabled={busy} onClick={() => onSendReceived(m.id)} title={m.senderName ? `Enviar a figurinha de ${m.senderName}` : 'Enviar figurinha'} aria-label="Enviar figurinha recebida">
                  {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado por link temporário */}
                  <img src={`/media/${m.id}`} alt="Figurinha recebida" loading="lazy" className="h-full w-full object-contain" />
                </button>
                <button type="button" disabled={busy} onClick={() => onSaveReceived(m.id)} className={cn(tiny, 'right-0.5 top-0.5')} aria-label="Salvar na biblioteca" title="Salvar na biblioteca da empresa">
                  <BookmarkPlus className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 border-t border-line pt-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/webp"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onUpload(file);
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:border-brand-line hover:text-brand-text disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" /> Adicionar figurinha (.webp)
        </button>
        <span className="text-[9px] text-muted">até 1 MB</span>
      </div>
    </div>
  );
}

/** Botão "Figurinhas" do campo de resposta: abre a janela, busca a lista e envia a escolhida. */
export function StickerButton({
  groupId,
  quotedId,
  disabled,
  canDelete,
  onSent,
}: {
  groupId: string;
  quotedId: string | null;
  disabled?: boolean;
  canDelete: boolean;
  onSent: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [library, setLibrary] = useState<StickerItem[]>([]);
  const [received, setReceived] = useState<ReceivedSticker[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const reload = async () => {
    const res = await loadStickers(groupId);
    if (!res.ok) return void toast.error(res.error);
    setLibrary(res.library);
    setReceived(res.received);
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadStickers(groupId).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (!res.ok) return void toast.error(res.error);
      setLibrary(res.library);
      setReceived(res.received);
    });
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', esc);
    window.addEventListener('mousedown', outside);
    return () => {
      alive = false;
      window.removeEventListener('keydown', esc);
      window.removeEventListener('mousedown', outside);
    };
  }, [open, groupId]);

  const run = async (job: () => Promise<{ ok: boolean; error?: string }>, success?: string, thenReload = false) => {
    setBusy(true);
    try {
      const res = await job();
      if (!res.ok) return void toast.error(res.error ?? 'Não foi possível concluir.');
      if (success) toast.success(success);
      if (thenReload) await reload();
      return true;
    } finally {
      setBusy(false);
    }
  };

  const send = async (kind: 'library' | 'message', id: string) => {
    const sent = await run(() => sendSticker(groupId, { kind, id }, quotedId), 'Figurinha na fila de envio');
    if (sent) {
      setOpen(false);
      onSent();
    }
  };

  const upload = async (file: File) => {
    const checked = validateStickerFile({ mime: file.type, size: file.size });
    if (!checked.ok) return void toast.error(checked.error);
    await run(async () => {
      const prep = await prepareStickerUpload({ mime: file.type, size: file.size });
      if (!prep.ok) return prep;
      const up = await createClient().storage.from('media').uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: 'image/webp' });
      if (up.error) return { ok: false, error: `Não foi possível enviar o arquivo: ${up.error.message}` };
      return addSticker({ path: prep.data.path, size: file.size, name: file.name });
    }, 'Figurinha adicionada à biblioteca', true);
  };

  return (
    <div ref={box} className="relative shrink-0">
      <button
        type="button"
        onClick={() => {
          // mostra "Carregando…" já ao abrir; a busca roda no efeito abaixo
          if (!open) setLoading(true);
          setOpen(!open);
        }}
        disabled={disabled}
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-ink-2 transition hover:border-brand-line hover:text-brand-text disabled:opacity-40"
        aria-label="Figurinhas"
        title="Figurinhas da empresa"
      >
        <Sticker className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute bottom-14 left-0 z-30">
          <StickerPanel
            library={library}
            received={received}
            loading={loading}
            busy={busy}
            canDelete={canDelete}
            onSendLibrary={(id) => void send('library', id)}
            onSendReceived={(id) => void send('message', id)}
            onSaveReceived={(id) => void run(() => saveReceivedSticker(id), 'Salva na biblioteca', true)}
            onFavorite={(id, fav) => void run(() => setStickerFavorite(id, fav), undefined, true)}
            onDelete={(id) => {
              if (confirm('Excluir esta figurinha da biblioteca da empresa?')) void run(() => deleteSticker(id), 'Figurinha excluída', true);
            }}
            onUpload={(file) => void upload(file)}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
