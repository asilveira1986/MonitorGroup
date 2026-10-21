'use client';

import { Bell, BellOff, ChevronDown } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { setCompanyMute, setGroupMute } from '@/app/(app)/actions';
import { cn } from '@/lib/format';

export const MUTE_OPTIONS = [
  { label: '1 hora', hours: 1 },
  { label: '8 horas', hours: 8 },
  { label: '24 horas', hours: 24 },
  { label: '7 dias', hours: 24 * 7 },
  { label: 'Sempre', hours: null },
] as const;

const untilFor = (hours: number | null) => (hours == null ? 'infinity' : new Date(Date.now() + hours * 3_600_000).toISOString());

/** "até 21/10 18:00" ou "sempre" */
export function muteLabel(until: string | null | undefined) {
  if (!until) return null;
  if (until === 'infinity' || until.startsWith('infinity')) return 'sempre';
  const d = new Date(until);
  if (Number.isNaN(d.getTime()) || d.getFullYear() > 9000) return 'sempre';
  return `até ${d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`;
}

export const isMutedNow = (until: string | null | undefined) =>
  Boolean(until) && (muteLabel(until) === 'sempre' || new Date(until!).getTime() > Date.now());

/** Menu com as durações (1 h, 8 h, 24 h, 7 dias, sempre). */
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
    <div ref={ref} role="menu" className="absolute right-0 top-full z-30 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface py-1 shadow-lg">
      <p className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Silenciar por</p>
      {MUTE_OPTIONS.map((o) => (
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

/**
 * Silenciar alertas do grupo: para os avisos (tela, voz, som e o aviso dos alertas por WhatsApp/e-mail) para
 * toda a empresa. O grupo continua monitorado normalmente.
 */
export function MuteControl({ groupId, mutedUntil, canMute }: { groupId: string; mutedUntil: string | null; canMute: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const muted = isMutedNow(mutedUntil);
  const run = (until: string | null) =>
    start(async () => {
      setOpen(false);
      const res = await setGroupMute(groupId, until);
      if (!res.ok) return void toast.error(res.error);
      toast.success(until ? 'Alertas do grupo silenciados' : 'Alertas do grupo reativados', {
        description: until ? 'O grupo continua monitorado (mensagens, pendências e lista de Alertas); só os avisos param.' : undefined,
      });
      router.refresh();
    });

  if (!canMute) {
    return muted ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-2 ring-1 ring-inset ring-line">
        <BellOff className="h-3.5 w-3.5" /> Alertas silenciados {muteLabel(mutedUntil)}
      </span>
    ) : null;
  }

  if (muted) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 text-xs font-medium text-warning-ink ring-1 ring-inset ring-warning/35">
          <BellOff className="h-3.5 w-3.5" /> Alertas silenciados {muteLabel(mutedUntil)}
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(null)}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-brand-text hover:bg-brand-soft disabled:opacity-50"
        >
          <Bell className="h-3.5 w-3.5" /> Reativar alertas
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <BellOff className="h-4 w-4" /> Silenciar alertas <ChevronDown className={cn('h-3.5 w-3.5 transition', open && 'rotate-180')} />
      </button>
      {open && <DurationMenu onPick={(h) => run(untilFor(h))} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** Quem administra a plataforma: silenciar ou reativar os alertas de todos os grupos da empresa atual. */
export function CompanyMuteControl({ mutedCount }: { mutedCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = (until: string | null) =>
    start(async () => {
      setOpen(false);
      if (!until && !confirm('Reativar os alertas de todos os grupos desta empresa?')) return;
      const res = await setCompanyMute(until);
      if (!res.ok) return void toast.error(res.error);
      toast.success(until ? `Alertas silenciados em ${res.count} grupo(s)` : `Alertas reativados em ${res.count} grupo(s)`);
      router.refresh();
    });
  return (
    <div className="relative flex items-center gap-2">
      {mutedCount > 0 && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(null)}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-brand-text hover:bg-brand-soft disabled:opacity-50"
        >
          <Bell className="h-4 w-4" /> Reativar alertas ({mutedCount})
        </button>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
      >
        <BellOff className="h-4 w-4" /> Silenciar alertas de todos <ChevronDown className={cn('h-3.5 w-3.5 transition', open && 'rotate-180')} />
      </button>
      {open && <DurationMenu onPick={(h) => run(untilFor(h))} onClose={() => setOpen(false)} />}
    </div>
  );
}
