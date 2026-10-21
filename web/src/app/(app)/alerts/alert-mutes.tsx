'use client';

import { Bell, BellOff, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { forgetMutedAlertTypes } from '@/components/message-notifier';
import { Card } from '@/components/ui';
import { cn } from '@/lib/format';
import { setAlertTypeMute } from '../actions';

export type AlertMuteItem = { type: string; label: string; hint: string };
export type AlertMuteRow = { type: string; muted_until: string; muted_by_name: string | null };

const OPTIONS = [
  { label: '1 hora', hours: 1 },
  { label: '8 horas', hours: 8 },
  { label: '24 horas', hours: 24 },
  { label: '7 dias', hours: 24 * 7 },
  { label: 'Sempre', hours: null },
] as const;

const untilFor = (hours: number | null) => (hours == null ? 'infinity' : new Date(Date.now() + hours * 3_600_000).toISOString());

/** "até 21/10 18:00" ou "sempre" */
function untilLabel(until: string) {
  if (until.startsWith('infinity')) return 'sempre';
  const d = new Date(until);
  if (Number.isNaN(d.getTime()) || d.getFullYear() > 9000) return 'sempre';
  return `até ${d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}

function DurationMenu({ onPick, onClose }: { onPick: (hours: number | null) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} role="menu" className="absolute right-0 top-full z-30 mt-1 w-40 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
      <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Silenciar por</p>
      {OPTIONS.map((o) => (
        <button
          key={o.label}
          type="button"
          role="menuitem"
          onClick={() => onPick(o.hours)}
          className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MuteRow({ item, mute, canMute }: { item: AlertMuteItem; mute: AlertMuteRow | undefined; canMute: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = (until: string | null) =>
    start(async () => {
      setOpen(false);
      const res = await setAlertTypeMute(item.type, until);
      if (!res.ok) return void toast.error(res.error);
      forgetMutedAlertTypes();
      toast.success(until ? `Avisos de "${item.label}" silenciados` : `Avisos de "${item.label}" reativados`, {
        description: until ? 'Os alertas continuam registrados na lista; só os avisos param.' : undefined,
      });
      router.refresh();
    });

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.label}</p>
        <p className="text-xs text-ink-2">
          {mute ? (
            <span className="font-medium text-warning-ink">
              Silenciado {untilLabel(mute.muted_until)}
              {mute.muted_by_name ? ` · por ${mute.muted_by_name}` : ''}
            </span>
          ) : (
            item.hint
          )}
        </p>
      </div>
      {canMute &&
        (mute ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run(null)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-brand-text hover:bg-brand-soft disabled:opacity-50"
          >
            <Bell className="h-3.5 w-3.5" /> Reativar
          </button>
        ) : (
          <div className="relative">
            <button
              type="button"
              disabled={pending}
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-label={`Silenciar ${item.label}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
            >
              <BellOff className="h-3.5 w-3.5" /> Silenciar <ChevronDown className={cn('h-3 w-3 transition', open && 'rotate-180')} />
            </button>
            {open && <DurationMenu onPick={(h) => run(untilFor(h))} onClose={() => setOpen(false)} />}
          </div>
        ))}
    </li>
  );
}

/**
 * Silenciar alertas por tipo: para os avisos (tela, voz, som, WhatsApp, e-mail) daquele tipo
 * para a empresa toda. Os alertas continuam sendo criados e aparecem na lista.
 */
export function AlertMutes({ items, mutes, canMute }: { items: AlertMuteItem[]; mutes: AlertMuteRow[]; canMute: boolean }) {
  const byType = new Map(mutes.map((m) => [m.type, m]));
  const [open, setOpen] = useState(false);
  const silenced = items.filter((i) => byType.has(i.type));
  if (!canMute && !silenced.length) return null;

  return (
    <Card className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left sm:px-5"
      >
        <BellOff className={cn('h-5 w-5 shrink-0', silenced.length ? 'text-warning-ink' : 'text-muted')} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Silenciar alertas</span>
          <span className="block text-xs text-ink-2">
            {silenced.length
              ? `Silenciados: ${silenced.map((i) => i.label).join(', ')}`
              : 'Pare os avisos de um tipo de alerta por um tempo ou sempre. Nenhum silenciado agora.'}
          </span>
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line px-4 pb-2 sm:px-5">
          <p className="pt-3 text-xs text-ink-2">
            Vale para a empresa toda: param o aviso em tela, a voz, o som e o aviso por WhatsApp/e-mail daquele tipo. O
            monitoramento não para: os alertas continuam na lista abaixo, e pendências e tempos seguem normais.
          </p>
          <ul className="divide-y divide-line">
            {(canMute ? items : silenced).map((i) => (
              <MuteRow key={i.type} item={i} mute={byType.get(i.type)} canMute={canMute} />
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
