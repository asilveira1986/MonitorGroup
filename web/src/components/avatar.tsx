'use client';

import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/format';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('') || '?';

const src = (jid: string, full = false) => `/avatar/${encodeURIComponent(jid)}${full ? '?tamanho=grande' : ''}`;

/** Foto ampliada, como no WhatsApp: fundo escuro, nome em cima e a foto no centro. */
function AvatarViewer({ jid, name, subtitle, onClose }: { jid: string; name: string; subtitle?: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Foto de ${name}`} className="fixed inset-0 z-[60] flex flex-col bg-black/90" onClick={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element -- foto privada por link temporário */}
        <img src={src(jid)} alt="" className="h-10 w-10 rounded-full object-cover" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{name}</p>
          {subtitle && <p className="truncate text-xs text-white/60">{subtitle}</p>}
        </div>
        <button type="button" onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="Fechar">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center p-4 pt-0">
        {/* eslint-disable-next-line @next/next/no-img-element -- foto privada por link temporário */}
        <img
          src={src(jid, true)}
          alt={`Foto de ${name}`}
          onClick={(e) => e.stopPropagation()}
          className="aspect-square max-h-[min(80vh,640px)] w-full max-w-[min(80vh,640px)] bg-white/5 object-cover shadow-2xl"
        />
      </div>
    </div>,
    document.body,
  );
}

/**
 * Foto de perfil do WhatsApp (contato ou grupo), guardada pelo worker. Sem foto, ou se a foto não
 * abrir, mostra as iniciais. Com `expandable`, clicar na foto amplia (como no WhatsApp).
 */
export function Avatar({
  jid,
  hasPhoto,
  name,
  className,
  fallback,
  expandable,
  subtitle,
}: {
  jid: string | null | undefined;
  hasPhoto: boolean | null | undefined;
  name: string;
  /** tamanho, cores e formato (ex.: "h-9 w-9 rounded-full bg-brand-soft text-xs") */
  className?: string;
  /** conteúdo no lugar das iniciais (ex.: um ícone) */
  fallback?: React.ReactNode;
  /** clicar na foto abre a visualização ampliada */
  expandable?: boolean;
  /** linha abaixo do nome na visualização ampliada (ex.: telefone) */
  subtitle?: string;
}) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  const base = cn('flex shrink-0 items-center justify-center overflow-hidden font-semibold', className);
  if (jid && hasPhoto && !broken) {
    const img = (
      // eslint-disable-next-line @next/next/no-img-element -- foto privada por link temporário
      <img src={src(jid)} alt="" loading="lazy" onError={() => setBroken(true)} className="h-full w-full object-cover" />
    );
    if (!expandable) return <span className={base}>{img}</span>;
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          className={cn(base, 'cursor-zoom-in transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-brand')}
          aria-label={`Ver a foto de ${name}`}
          title="Ver foto"
        >
          {img}
        </button>
        {open && <AvatarViewer jid={jid} name={name} subtitle={subtitle} onClose={() => setOpen(false)} />}
      </>
    );
  }
  return (
    <span className={base} aria-hidden>
      {fallback ?? initials(name)}
    </span>
  );
}
