'use client';

import { ChevronDown, Download, FileText, Film, FolderOpen, Loader2, Mic } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Card, EmptyState } from '@/components/ui';
import { cn, formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { Lightbox } from './message-media';

type FileRow = {
  id: string;
  message_type: string;
  body: string | null;
  media_size: number | null;
  sent_at: string;
  sender_name: string | null;
  from_team: boolean;
};

const PAGE = 48;
const KINDS = [
  { key: 'all', label: 'Todos', types: ['image', 'video', 'document', 'audio', 'sticker'] },
  { key: 'image', label: 'Imagens', types: ['image', 'sticker'] },
  { key: 'video', label: 'Vídeos', types: ['video'] },
  { key: 'document', label: 'Documentos', types: ['document'] },
  { key: 'audio', label: 'Áudios', types: ['audio'] },
] as const;

const size = (b: number | null) =>
  b == null ? '' : b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

/**
 * Arquivos do grupo: imagens, vídeos, documentos e áudios guardados, para ver sem rolar a conversa.
 * Só carrega quando aberto (não pesa na abertura da tela do grupo).
 */
export function GroupFiles({ groupId, timeZone }: { groupId: string; timeZone?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof KINDS)[number]['key']>('all');
  const [rows, setRows] = useState<FileRow[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [zoom, setZoom] = useState<FileRow | null>(null);

  const load = useCallback(
    async (reset: boolean, which = kind) => {
      setLoading(true);
      const types = KINDS.find((k) => k.key === which)!.types as readonly string[];
      let q = createClient()
        .from('messages')
        .select('id, message_type, body, media_size, sent_at, sender_name, from_team')
        .eq('group_id', groupId)
        .not('media_path', 'is', null)
        .in('message_type', [...types])
        .order('sent_at', { ascending: false })
        .limit(PAGE);
      const last = reset ? null : rows[rows.length - 1];
      if (last) q = q.lt('sent_at', last.sent_at);
      const { data } = await q;
      const page = (data ?? []) as FileRow[];
      setRows((prev) => (reset ? page : [...prev, ...page]));
      setMore(page.length === PAGE);
      setLoading(false);
    },
    [groupId, kind, rows],
  );


  const visual = rows.filter((r) => r.message_type === 'image' || r.message_type === 'sticker' || r.message_type === 'video');
  const others = rows.filter((r) => !visual.includes(r));

  return (
    <Card className="mt-4">
      <button
        type="button"
        onClick={() => {
          if (!open) void load(true);
          setOpen(!open);
        }}
        className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left sm:px-5"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-muted" />
          <span>
            <span className="block text-sm font-semibold">Arquivos do grupo</span>
            <span className="block text-xs text-ink-2">Imagens, vídeos, documentos e áudios enviados no grupo</span>
          </span>
        </span>
        <ChevronDown className={cn('h-5 w-5 text-muted transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="border-t border-line px-4 pb-5 pt-3 sm:px-5">
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Tipo de arquivo">
            {KINDS.map((k) => (
              <button
                key={k.key}
                type="button"
                onClick={() => {
                  setKind(k.key);
                  void load(true, k.key);
                }}
                aria-pressed={kind === k.key}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium',
                  kind === k.key ? 'border-ink bg-ink text-bg' : 'border-line text-ink-2 hover:text-ink',
                )}
              >
                {k.label}
              </button>
            ))}
          </div>

          {rows.length === 0 && !loading ? (
            <EmptyState
              icon={<FolderOpen />}
              title="Nenhum arquivo guardado"
              description="Os arquivos aparecem aqui conforme chegam nos grupos (os anteriores à função ficam só com a indicação do tipo na conversa)."
            />
          ) : (
            <>
              {visual.length > 0 && (
                <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {visual.map((r) => (
                    <li key={r.id} className="group relative aspect-square overflow-hidden rounded-xl bg-surface-2">
                      {r.message_type === 'video' ? (
                        <a href={`/media/${r.id}`} target="_blank" rel="noreferrer" className="flex h-full w-full items-center justify-center">
                          <video src={`/media/${r.id}`} preload="metadata" muted className="h-full w-full object-cover" />
                          <Film className="absolute h-7 w-7 text-white drop-shadow" />
                        </a>
                      ) : (
                        <button type="button" onClick={() => setZoom(r)} className="h-full w-full" title="Ampliar">
                          {/* eslint-disable-next-line @next/next/no-img-element -- arquivo privado por link temporário */}
                          <img src={`/media/${r.id}`} alt={r.body ?? 'Imagem'} loading="lazy" className="h-full w-full object-cover" />
                        </button>
                      )}
                      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">
                        {r.sender_name ?? (r.from_team ? 'Equipe' : 'Cliente')} · {formatDateTime(r.sent_at, timeZone)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {others.length > 0 && (
                <ul className={cn('divide-y divide-line rounded-xl border border-line', visual.length > 0 && 'mt-3')}>
                  {others.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                      {r.message_type === 'audio' ? (
                        <Mic className="h-5 w-5 shrink-0 text-muted" />
                      ) : (
                        <FileText className="h-5 w-5 shrink-0 text-muted" />
                      )}
                      <div className="min-w-0 flex-1">
                        {r.message_type === 'audio' ? (
                          <audio controls preload="none" src={`/media/${r.id}`} className="h-9 w-full max-w-xs" />
                        ) : (
                          <a href={`/media/${r.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
                            {r.body || 'Documento'}
                          </a>
                        )}
                        <p className="truncate text-[11px] text-muted">
                          {r.sender_name ?? (r.from_team ? 'Equipe' : 'Cliente')} · {formatDateTime(r.sent_at, timeZone)}
                          {r.media_size ? ` · ${size(r.media_size)}` : ''}
                        </p>
                      </div>
                      <a
                        href={`/media/${r.id}?download=1`}
                        className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-ink"
                        aria-label="Baixar"
                        title="Baixar"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-3 flex justify-center">
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-muted" />
                ) : (
                  more && (
                    <button
                      type="button"
                      onClick={() => void load(false)}
                      className="rounded-full bg-surface-2 px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
                    >
                      Carregar mais
                    </button>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}
      {zoom && <Lightbox src={`/media/${zoom.id}`} alt={zoom.body ?? 'Imagem'} onClose={() => setZoom(null)} />}
    </Card>
  );
}
