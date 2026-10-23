'use client';

import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';

type Prepared = { ok: true; data: { path: string; token: string } } | { ok: false; error: string };
type Saved = { ok: true } | { ok: false; error: string };

/**
 * Enviar / trocar / tirar uma imagem (logo da empresa, foto do atendente): sobe direto para o
 * Storage pelo link de upload e grava o caminho. `src` é a imagem atual (null = sem imagem).
 */
export function ImageUpload({
  src,
  prepare,
  save,
  label,
  fallback,
  round = false,
  size = 'h-14 w-14',
  disabled,
  compact = false,
}: {
  /** só a imagem, clicável (troca); tirar fica em outro lugar (ex.: menu da linha) */
  compact?: boolean;
  src: string | null;
  prepare: (file: { mime: string; size: number }) => Promise<Prepared>;
  save: (path: string | null) => Promise<Saved>;
  label: string;
  fallback: React.ReactNode;
  round?: boolean;
  size?: string;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  // a imagem atual muda de endereço só pelo parâmetro: força o navegador a buscar de novo
  const [version, setVersion] = useState(0);
  const [broken, setBroken] = useState(false);
  const shown = src && !broken ? `${src}${src.includes('?') ? '&' : '?'}v=${version}` : null;

  const upload = (file: File) =>
    start(async () => {
      const prep = await prepare({ mime: file.type, size: file.size });
      if (!prep.ok) return void toast.error(prep.error);
      const up = await createClient().storage.from('media').uploadToSignedUrl(prep.data.path, prep.data.token, file, { contentType: file.type });
      if (up.error) return void toast.error('Não foi possível enviar a imagem', { description: up.error.message });
      const res = await save(prep.data.path);
      if (!res.ok) return void toast.error(res.error);
      setBroken(false);
      setVersion((v) => v + 1);
      toast.success('Imagem salva');
    });
  const remove = () =>
    start(async () => {
      const res = await save(null);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Imagem retirada');
    });

  const picker = (
    <input
      ref={input}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) upload(f);
        e.target.value = '';
      }}
    />
  );
  if (compact) {
    const box = cn('relative flex shrink-0 items-center justify-center overflow-hidden', size, round ? 'rounded-full' : 'rounded-xl');
    const inner = shown ? (
      // eslint-disable-next-line @next/next/no-img-element -- imagem privada por link temporário
      <img src={shown} alt={label} onError={() => setBroken(true)} className="h-full w-full object-cover" />
    ) : (
      fallback
    );
    if (disabled) return <span className={box}>{inner}</span>;
    return (
      <button type="button" disabled={pending} onClick={() => input.current?.click()} className={cn(box, 'group')} title={label} aria-label={label}>
        {inner}
        <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-white group-hover:flex">
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
        </span>
        {pending && (
          <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-white">
            <Loader2 className="h-4 w-4 animate-spin" />
          </span>
        )}
        {picker}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <span className={cn('flex shrink-0 items-center justify-center overflow-hidden border border-line bg-surface-2', size, round ? 'rounded-full' : 'rounded-xl')}>
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element -- imagem privada por link temporário
          <img src={shown} alt={label} onError={() => setBroken(true)} className={cn('h-full w-full', round ? 'object-cover' : 'object-contain p-1')} />
        ) : (
          fallback
        )}
      </span>
      {!disabled && (
        <div className="flex flex-wrap items-center gap-1">
          {picker}
          <button
            type="button"
            disabled={pending}
            onClick={() => input.current?.click()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-text hover:bg-surface-2 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {shown ? 'Trocar' : label}
          </button>
          {shown && (
            <button
              type="button"
              disabled={pending}
              onClick={remove}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-critical-ink disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" /> Tirar
            </button>
          )}
        </div>
      )}
    </div>
  );
}
