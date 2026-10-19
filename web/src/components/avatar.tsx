'use client';

import { useState } from 'react';
import { cn } from '@/lib/format';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('') || '?';

/**
 * Foto de perfil do WhatsApp (contato ou grupo), guardada pelo worker. Sem foto, ou se a foto não
 * abrir, mostra as iniciais.
 */
export function Avatar({
  jid,
  hasPhoto,
  name,
  className,
  fallback,
}: {
  jid: string | null | undefined;
  hasPhoto: boolean | null | undefined;
  name: string;
  /** tamanho, cores e formato (ex.: "h-9 w-9 rounded-full bg-brand-soft text-xs") */
  className?: string;
  /** conteúdo no lugar das iniciais (ex.: um ícone) */
  fallback?: React.ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const base = cn('flex shrink-0 items-center justify-center overflow-hidden font-semibold', className);
  if (jid && hasPhoto && !broken) {
    return (
      <span className={base}>
        {/* eslint-disable-next-line @next/next/no-img-element -- foto privada por link temporário */}
        <img
          src={`/avatar/${encodeURIComponent(jid)}`}
          alt=""
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover"
        />
      </span>
    );
  }
  return (
    <span className={base} aria-hidden>
      {fallback ?? initials(name)}
    </span>
  );
}
