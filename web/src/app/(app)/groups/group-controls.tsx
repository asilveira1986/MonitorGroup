'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronDown, X } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Input, Select, Toggle } from '@/components/ui';
import { cn } from '@/lib/format';
import { useRealtime } from '@/lib/use-realtime';
import { markSenderAsTeam, setGroupMonitored, setGroupResponsibles, setGroupSector, setGroupSla } from '../actions';

/** Setor do grupo (somente admin): define quem vê e age sobre o grupo. */
export function SectorSelect({
  groupId,
  sectorId,
  sectors,
}: {
  groupId: string;
  sectorId: string | null;
  sectors: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(sectorId ?? '');
  const [pending, start] = useTransition();
  return (
    <Select
      value={value}
      disabled={pending}
      aria-label="Setor do grupo"
      className="h-9 text-sm"
      onChange={(e) => {
        const next = e.target.value;
        const prev = value;
        setValue(next);
        start(async () => {
          const res = await setGroupSector(groupId, next || null);
          if (!res.ok) {
            setValue(prev);
            toast.error(res.error);
          } else toast.success(next ? 'Setor do grupo alterado' : 'Grupo sem setor: só administradores veem');
        });
      }}
    >
      <option value="">Sem setor (só administradores)</option>
      {sectors.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </Select>
  );
}

/** Responsáveis pelo grupo (somente admin): uma ou mais pessoas da equipe, ou nenhuma. */
export function ResponsiblesSelect({
  groupId,
  memberIds,
  members,
}: {
  groupId: string;
  memberIds: string[];
  members: { id: string; name: string }[];
}) {
  const [value, setValue] = useState<string[]>(memberIds);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  const save = (next: string[]) => {
    const prev = value;
    setValue(next);
    start(async () => {
      const res = await setGroupResponsibles(groupId, next);
      if (!res.ok) {
        setValue(prev);
        toast.error(res.error);
      } else toast.success(next.length ? `Responsáveis: ${next.map((id) => nameOf.get(id) ?? '?').join(', ')}` : 'Grupo sem responsável');
    });
  };
  const toggle = (id: string) => save(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const term = q.trim().toLowerCase();
  const shown = members.filter((m) => !term || m.name.toLowerCase().includes(term));

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Responsáveis pelo grupo"
        className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-xl border border-line bg-surface px-2 py-1 text-left text-sm hover:bg-surface-2"
      >
        {value.length ? (
          value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2 pr-1 text-xs font-medium text-brand-text">
              {nameOf.get(id) ?? 'Responsável'}
              <span
                role="button"
                tabIndex={0}
                aria-label={`Tirar ${nameOf.get(id) ?? 'responsável'}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!pending) toggle(id);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!pending) toggle(id);
                  }
                }}
                className="rounded-full p-0.5 hover:bg-brand/20"
              >
                <X className="h-3 w-3" />
              </span>
            </span>
          ))
        ) : (
          <span className="px-1 text-ink-2">Sem responsável</span>
        )}
        <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          {members.length > 6 && (
            <div className="border-b border-line p-2">
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pessoa" aria-label="Buscar pessoa da equipe" className="h-8 text-sm" autoFocus />
            </div>
          )}
          <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-y-auto py-1">
            {shown.map((m) => {
              const on = value.includes(m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    disabled={pending}
                    onClick={() => toggle(m.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 disabled:opacity-60"
                  >
                    <span
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        on ? 'border-brand bg-brand text-brand-ink' : 'border-line',
                      )}
                      aria-hidden
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{m.name}</span>
                  </button>
                </li>
              );
            })}
            {shown.length === 0 && <li className="px-3 py-2 text-sm text-muted">Ninguém encontrado.</li>}
          </ul>
          {value.length > 0 && (
            <div className="border-t border-line p-1">
              <button
                type="button"
                disabled={pending}
                onClick={() => save([])}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs text-ink-2 hover:bg-surface-2"
              >
                Tirar todos os responsáveis
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MonitorToggle({ groupId, monitored, label }: { groupId: string; monitored: boolean; label?: string }) {
  const [value, setValue] = useState(monitored);
  const [pending, start] = useTransition();
  return (
    <Toggle
      checked={value}
      disabled={pending}
      label={label}
      onChange={(checked) => {
        setValue(checked);
        start(async () => {
          const res = await setGroupMonitored(groupId, checked);
          if (!res.ok) {
            setValue(!checked);
            toast.error(res.error);
          } else toast.success(checked ? 'Grupo monitorado' : 'Grupo ignorado');
        });
      }}
    />
  );
}

export function SlaForm({ groupId, sla, defaultSla }: { groupId: string; sla: number | null; defaultSla: number }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="flex items-center gap-2"
      action={(form) =>
        start(async () => {
          const raw = String(form.get('sla') ?? '').trim();
          const res = await setGroupSla(groupId, raw ? Number(raw) : null);
          if (res.ok) toast.success('SLA atualizado');
          else toast.error(res.error);
        })
      }
    >
      <Input
        name="sla"
        type="number"
        min={1}
        defaultValue={sla ?? ''}
        placeholder={`${defaultSla} (padrão)`}
        className="w-32 sm:h-8 sm:text-xs"
        aria-label="SLA em minutos"
      />
      <span className="text-xs text-muted">min</span>
      <Button size="sm" variant="secondary" disabled={pending}>
        Salvar
      </Button>
    </form>
  );
}

export function MarkTeamButton({ jid, name, phone }: { jid: string; name: string; phone: string | null }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      className="text-[11px] text-muted underline-offset-2 hover:text-brand-text hover:underline disabled:opacity-50"
      onClick={() => {
        const finalName = window.prompt('Marcar este remetente como membro da equipe. Nome:', name);
        if (!finalName) return;
        start(async () => {
          const res = await markSenderAsTeam(jid, finalName, phone);
          if (res.ok) toast.success(`${finalName} agora conta como equipe`);
          else toast.error(res.error);
        });
      }}
    >
      é da equipe?
    </button>
  );
}

/** Atualiza a conversa quando chega mensagem nova no grupo. */
export function LiveMessages({ groupId }: { groupId: string }) {
  const router = useRouter();
  useRealtime(`group-${groupId}`, (channel) =>
    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
        () => router.refresh(),
      )
      // respostas do painel: na fila, enviando, enviada ou com falha
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'outgoing_messages', filter: `group_id=eq.${groupId}` },
        () => router.refresh(),
      ),
  );
  return null;
}
