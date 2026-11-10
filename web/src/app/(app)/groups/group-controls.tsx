'use client';

import { useRouter } from 'next/navigation';
import { Check, ChevronDown, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Input, Select, Toggle } from '@/components/ui';
import { cn } from '@/lib/format';
import { useRealtime } from '@/lib/use-realtime';
import { setMessageSender, setGroupMonitored, setGroupResponsibles, setGroupSector, setGroupSla } from '../actions';

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
      className="h-9 text-[12px] sm:text-[12px]"
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
        className="flex min-h-9 w-full flex-wrap items-center gap-1 rounded-xl border border-line bg-surface px-2 py-1 text-left text-[12px] hover:bg-surface-2"
      >
        {value.length ? (
          value.map((id) => (
            <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-soft py-0.5 pl-2 pr-1 text-[12px] font-medium text-brand-text">
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

/**
 * SLA do grupo (só administradores, na tela Grupos): minutos para responder. Vazio = o padrão da empresa.
 * Salva ao apertar Enter ou ao sair do campo, só se mudou.
 */
export function SlaField({ groupId, sla, defaultSla, className }: { groupId: string; sla: number | null; defaultSla: number; className?: string }) {
  const [value, setValue] = useState(sla === null ? '' : String(sla));
  const [saved, setSaved] = useState(sla === null ? '' : String(sla));
  const [pending, start] = useTransition();
  const save = () => {
    const raw = value.trim();
    if (raw === saved) return;
    const minutes = raw ? Math.round(Number(raw)) : null;
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 1)) {
      setValue(saved);
      return void toast.error('Informe o SLA em minutos (1 ou mais), ou deixe vazio para usar o padrão.');
    }
    start(async () => {
      const res = await setGroupSla(groupId, minutes);
      if (!res.ok) {
        setValue(saved);
        return void toast.error(res.error);
      }
      const now = minutes === null ? '' : String(minutes);
      setValue(now);
      setSaved(now);
      toast.success(minutes === null ? `SLA do grupo: padrão (${defaultSla} min)` : `SLA do grupo: ${minutes} min`);
    });
  };
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)}>
      <Input
        type="number"
        min={1}
        max={10080}
        value={value}
        disabled={pending}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
          if (e.key === 'Escape') {
            setValue(saved);
            e.currentTarget.blur();
          }
        }}
        placeholder={`${defaultSla}`}
        title={value ? 'SLA deste grupo, em minutos' : `Sem SLA próprio: vale o padrão da empresa (${defaultSla} min)`}
        aria-label="SLA do grupo em minutos"
        className="h-8 w-20 px-2 text-center text-xs sm:h-8 sm:text-xs"
      />
      <span className="text-[9px] text-muted">{value ? 'min' : 'padrão'}</span>
    </span>
  );
}

/**
 * Mensagem que o WhatsApp mandou sem remetente: "quem enviou?" deixa escolher o atendente
 * (ou o cliente). Vale só para esta mensagem; o grupo é recalculado.
 */
export function MessageSenderPicker({
  messageId,
  members,
  current,
}: {
  messageId: string;
  members: { id: string; name: string }[];
  current: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[9px] text-muted underline-offset-2 hover:text-brand-text hover:underline"
        title="O WhatsApp não informou quem mandou esta mensagem: indique se foi alguém da equipe"
      >
        quem enviou?
      </button>
    );
  }
  return (
    <select
      autoFocus
      disabled={pending}
      defaultValue={current ?? ''}
      onBlur={() => !pending && setOpen(false)}
      onChange={(e) => {
        const id = e.target.value || null;
        start(async () => {
          const res = await setMessageSender(messageId, id);
          if (!res.ok) toast.error(res.error);
          else toast.success(id ? 'Mensagem marcada como da equipe' : 'Mensagem marcada como do cliente');
          setOpen(false);
          router.refresh();
        });
      }}
      className="h-6 rounded-md border border-line bg-surface px-1 text-[9px] text-ink"
      aria-label="Quem enviou esta mensagem"
    >
      <option value="">Cliente</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>
          {m.name} (equipe)
        </option>
      ))}
    </select>
  );
}

/**
 * Atualiza os números e a fila da tela do grupo quando chega mensagem ou muda uma resposta do
 * painel. A mensagem nova já aparece na conversa na hora (tempo real); aqui a tela é recarregada
 * no máximo a cada poucos segundos, juntando várias mensagens numa atualização só.
 */
export function LiveMessages({ groupId }: { groupId: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schedule = useCallback(
    (ms: number) => {
      if (timer.current) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (document.visibilityState === 'visible') router.refresh();
      }, ms);
    },
    [router],
  );
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useRealtime(`group-${groupId}`, (channel) =>
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` }, () =>
        schedule(4000),
      )
      // respostas do painel: na fila, enviando, enviada ou com falha
      .on('postgres_changes', { event: '*', schema: 'public', table: 'outgoing_messages', filter: `group_id=eq.${groupId}` }, () =>
        schedule(700),
      ),
  );
  return null;
}
