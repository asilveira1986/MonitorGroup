'use client';

import { Loader2, Paperclip, Plus, Trash2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Field, Input, Textarea, Toggle } from '@/components/ui';
import { MAX_MEDIA_BYTES, MAX_VARIANTS, MEDIA_TYPE_LABEL, WEEKDAY_LABEL, type BroadcastMedia, type BroadcastWindow } from '@/lib/broadcast';
import { cn } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { prepareBroadcastUpload } from './actions';

/** Variações do texto: cada destinatário recebe uma delas (ou o texto principal), sorteada. */
export function VariantsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-ink-2">Variações do texto (opcional)</p>
      <p className="text-xs text-muted">Cada destinatário recebe uma delas (ou o texto principal) sorteada. Mensagens diferentes reduzem o risco de bloqueio.</p>
      {value.map((v, i) => (
        <div key={i} className="flex gap-2">
          <Textarea value={v} onChange={(e) => onChange(value.map((x, j) => (j === i ? e.target.value : x)))} rows={3} maxLength={4000} placeholder={`Variação ${i + 1}`} />
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="h-9 shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label={`Remover a variação ${i + 1}`}>
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      {value.length < MAX_VARIANTS && (
        <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...value, ''])}>
          <Plus className="h-4 w-4" /> Adicionar variação
        </Button>
      )}
    </div>
  );
}

/** Arquivo do disparo (imagem, vídeo, documento ou áudio): sobe direto para o Storage. */
export function MediaField({ value, onChange, onBusyChange }: { value: BroadcastMedia | null; onChange: (m: BroadcastMedia | null) => void; onBusyChange?: (busy: boolean) => void }) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const busy = (b: boolean) => {
    setUploading(b);
    onBusyChange?.(b);
  };

  const upload = async (file: File) => {
    busy(true);
    try {
      const prep = await prepareBroadcastUpload({ name: file.name, mime: file.type, size: file.size });
      if (!prep.ok) {
        toast.error(prep.error);
        return;
      }
      const up = await createClient().storage.from('media').uploadToSignedUrl(prep.media.path, prep.token, file, { contentType: prep.media.mime });
      if (up.error) {
        toast.error('Não foi possível enviar o arquivo. Tente de novo.');
        return;
      }
      onChange(prep.media);
    } finally {
      busy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-ink-2">Arquivo (opcional)</p>
      <input ref={fileRef} type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
      {value ? (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line/80 px-3 py-2 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip className="h-4 w-4 shrink-0 text-muted" />
            <span className="truncate">{value.name}</span>
            <Badge tone="brand">{MEDIA_TYPE_LABEL[value.type]}</Badge>
          </span>
          <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label="Tirar o arquivo">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} {uploading ? 'Enviando…' : 'Anexar imagem, vídeo, documento ou áudio'}
        </Button>
      )}
      <p className="text-xs text-muted">Até {MAX_MEDIA_BYTES / 1024 / 1024} MB. Áudio vai sem texto.</p>
    </div>
  );
}

/** Dias e horários em que o envio pode sair (no fuso da empresa). */
export function WindowField({
  enabled,
  onEnabledChange,
  value,
  onChange,
  timezone,
}: {
  enabled: boolean;
  onEnabledChange: (on: boolean) => void;
  value: BroadcastWindow;
  onChange: (w: BroadcastWindow) => void;
  timezone: string;
}) {
  return (
    <div className="space-y-3">
      <Toggle checked={enabled} onChange={onEnabledChange} label="Só enviar em certos dias e horários" />
      {enabled && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAY_LABEL.map((d, i) => {
              const on = value.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ ...value, days: on ? value.days.filter((x) => x !== i) : [...value.days, i].sort() })}
                  className={cn('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition', on ? 'bg-brand-soft text-ink ring-brand-line' : 'bg-surface text-ink-2 ring-line hover:bg-surface-2')}
                >
                  {d}
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Das">
              <Input type="time" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} className="w-32" />
            </Field>
            <Field label="Até">
              <Input type="time" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} className="w-32" />
            </Field>
          </div>
          <p className="text-xs text-muted">Fuso da empresa: {timezone}. Fora desse horário o envio espera e continua sozinho quando a janela abrir.</p>
        </div>
      )}
    </div>
  );
}
