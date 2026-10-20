'use client';

import { Download, ExternalLink, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Message } from '@/lib/types';

const formatSize = (bytes: number | null | undefined) =>
  bytes == null ? '' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

const UNAVAILABLE: Record<string, (m: Message) => string> = {
  too_large: (m) => `Arquivo grande demais para guardar${m.media_size ? ` (${formatSize(m.media_size)})` : ''}. Veja no celular.`,
  failed: () => 'Não foi possível baixar o arquivo do WhatsApp. Veja no celular.',
  expired: () => 'Arquivo apagado pelo prazo de guarda.',
};

/** Imagem ampliada, por cima da tela. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/85 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado por link temporário */}
      <img src={src} alt={alt} className="max-h-[82vh] max-w-full rounded-lg object-contain shadow-2xl" />
      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        <a
          href={`${src}?download=1`}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25"
        >
          <Download className="h-4 w-4" /> Baixar
        </a>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-sm text-white hover:bg-white/25"
        >
          <X className="h-4 w-4" /> Fechar
        </button>
      </div>
    </div>
  );
}

/**
 * Imagem, figurinha, áudio, vídeo ou documento guardado da mensagem.
 * Abrir/tocar conta como visto (dá baixa no arquivo do cliente).
 */
export function MessageMedia({ message: m, onViewed }: { message: Message; onViewed: () => void }) {
  const [zoom, setZoom] = useState(false);
  const [broken, setBroken] = useState(false);

  if (!m.media_path) {
    const note = m.media_status ? UNAVAILABLE[m.media_status]?.(m) : null;
    return note ? <p className="mb-1 text-xs italic text-muted">{note}</p> : null;
  }
  if (broken) return <p className="mb-1 text-xs italic text-muted">Não foi possível abrir o arquivo.</p>;

  const src = `/media/${m.id}`;
  const label = m.body || 'Imagem';

  if (m.message_type === 'image' || m.message_type === 'sticker') {
    const sticker = m.message_type === 'sticker';
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setZoom(true);
            onViewed();
          }}
          className="mb-1 block overflow-hidden rounded-xl"
          title="Ampliar"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado por link temporário */}
          <img
            src={src}
            alt={sticker ? 'Figurinha' : label}
            loading="lazy"
            onError={() => setBroken(true)}
            className={sticker ? 'h-28 w-28 object-contain' : 'max-h-72 w-auto max-w-full object-cover'}
          />
        </button>
        {zoom && <Lightbox src={src} alt={sticker ? 'Figurinha' : label} onClose={() => setZoom(false)} />}
      </>
    );
  }

  if (m.message_type === 'audio') {
    return (
      <audio
        controls
        preload="none"
        src={src}
        onPlay={onViewed}
        onError={() => setBroken(true)}
        className="mb-1 h-10 w-72 max-w-full"
        aria-label="Áudio da mensagem"
      />
    );
  }

  if (m.message_type === 'video') {
    return (
      <video
        controls
        preload="metadata"
        src={src}
        onPlay={onViewed}
        onError={() => setBroken(true)}
        className="mb-1 max-h-72 max-w-full rounded-xl bg-black"
      />
    );
  }

  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <FileText className="h-5 w-5 shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm">
        {m.body || 'Documento'} <span className="text-xs text-muted">{formatSize(m.media_size)}</span>
      </span>
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        onClick={onViewed}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-text hover:underline"
      >
        <ExternalLink className="h-3.5 w-3.5" /> Abrir
      </a>
      <a
        href={`${src}?download=1`}
        onClick={onViewed}
        className="inline-flex items-center gap-1 text-xs font-medium text-brand-text hover:underline"
      >
        <Download className="h-3.5 w-3.5" /> Baixar
      </a>
    </div>
  );
}
