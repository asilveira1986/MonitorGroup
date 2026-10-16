'use client';

import { CalendarClock, HardDrive, Image as ImageIcon, Save } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Select } from '@/components/ui';
import { cn } from '@/lib/format';
import type { AppSettings } from '@/lib/types';
import { saveMediaSettings } from './actions';
import { Row } from './demand-settings';

const TYPES = [
  { key: 'image', label: 'Imagens' },
  { key: 'audio', label: 'Áudios' },
  { key: 'sticker', label: 'Figurinhas' },
  { key: 'video', label: 'Vídeos' },
  { key: 'document', label: 'Documentos (PDF etc.)' },
];

const RETENTION = [30, 60, 90, 180, 365, 0];

export type MediaUsage = { files: number; bytes: number; oldest: string | null };

const formatBytes = (b: number) =>
  b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.round(b / 1024)} KB`;

/** Imagens e áudios guardados para ver pelo sistema: liga/desliga, tipos e prazo de guarda. */
export function MediaSettings({ settings, usage, disabled }: { settings: AppSettings; usage: MediaUsage | null; disabled: boolean }) {
  const [enabled, setEnabled] = useState(settings.media_store_enabled !== false);
  const [types, setTypes] = useState<string[]>(settings.media_store_types ?? ['image', 'audio', 'sticker']);
  const [days, setDays] = useState(settings.media_retention_days ?? 90);
  const [pending, start] = useTransition();
  const lock = disabled || pending;
  const toggleType = (key: string) => setTypes((t) => (t.includes(key) ? t.filter((x) => x !== key) : [...t, key]));

  return (
    <Card>
      <CardHeader
        title="Imagens e áudios"
        description="Guarda os arquivos que chegam nos grupos monitorados para ver e ouvir na conversa do grupo, sem precisar do celular. Ficam num armazenamento privado: só quem pode ver a conversa abre o arquivo."
      />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={ImageIcon}
          title="Guardar arquivos das mensagens"
          text="Vale para as mensagens novas a partir de agora (as anteriores e as do histórico importado ficam só com a indicação do tipo)."
          checked={enabled}
          onChange={setEnabled}
          disabled={lock}
        />
        {enabled && (
          <>
            <div className="py-3">
              <p className="text-sm font-medium">O que guardar</p>
              <p className="mt-0.5 text-xs text-ink-2">Vídeos e documentos ocupam mais espaço. Arquivos acima de 25 MB não são guardados.</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {TYPES.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    disabled={lock}
                    aria-pressed={types.includes(t.key)}
                    onClick={() => toggleType(t.key)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition disabled:opacity-50',
                      types.includes(t.key)
                        ? 'border-brand-line bg-brand-soft text-brand-text'
                        : 'border-line text-ink-2 hover:border-brand-line hover:text-ink',
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
                <div>
                  <p className="text-sm font-medium">Por quanto tempo guardar</p>
                  <p className="mt-0.5 text-xs text-ink-2">Depois do prazo o arquivo é apagado; a mensagem continua na conversa.</p>
                </div>
              </div>
              <Select
                value={String(days)}
                onChange={(e) => setDays(Number(e.target.value))}
                disabled={lock}
                className="sm:w-56"
                aria-label="Prazo de guarda dos arquivos"
              >
                {RETENTION.map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'Sempre (não apagar)' : d === 365 ? '1 ano' : `${d} dias`}
                  </option>
                ))}
              </Select>
            </div>
          </>
        )}
        {usage && (
          <div className="flex gap-3 py-3">
            <HardDrive className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
            <p className="text-sm text-ink-2">
              Em uso: <strong className="text-ink">{formatBytes(usage.bytes)}</strong> em {usage.files.toLocaleString('pt-BR')}{' '}
              arquivo(s).
            </p>
          </div>
        )}
      </div>
      {!disabled && (
        <div className="px-4 pb-5 sm:px-5">
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await saveMediaSettings({ enabled, types, days });
                if (res.ok) toast.success('Imagens e áudios salvos');
                else toast.error(res.error);
              })
            }
          >
            <Save className="h-4 w-4" /> Salvar imagens e áudios
          </Button>
        </div>
      )}
    </Card>
  );
}
