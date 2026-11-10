'use client';

import { Check, ChevronDown, Search, Users, X, Building2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/format';

type Option = { id: string; name: string; hint?: string };

/** Lista com marcação (várias escolhas) dentro de uma janela que abre embaixo do botão; só aplica ao clicar em "Aplicar". */
function MultiPick({
  label,
  icon: Icon,
  options,
  selected,
  onApply,
  searchable = false,
  emptyText,
}: {
  label: string;
  icon: typeof Users;
  options: Option[];
  selected: string[];
  onApply: (ids: string[]) => void;
  searchable?: boolean;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>(selected);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const outside = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('keydown', esc);
    window.addEventListener('mousedown', outside);
    return () => {
      window.removeEventListener('keydown', esc);
      window.removeEventListener('mousedown', outside);
    };
  }, [open]);

  const term = q.trim().toLowerCase();
  const shown = options.filter((o) => !term || o.name.toLowerCase().includes(term));
  const toggle = (id: string) => setDraft((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const names = selected.map((id) => options.find((o) => o.id === id)?.name).filter(Boolean) as string[];
  const summary = !names.length ? 'Todos' : names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!open) {
            setDraft(selected);
            setQ('');
          }
          setOpen(!open);
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={names.length ? names.join(', ') : undefined}
        className={cn(
          'inline-flex h-9 max-w-[16rem] items-center gap-1.5 rounded-xl border bg-surface px-3 text-sm transition hover:border-ink-2',
          selected.length ? 'border-brand-line bg-brand-soft/40 font-medium' : 'border-line text-ink-2',
        )}
      >
        <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="text-[9px] font-semibold uppercase tracking-wide text-muted">{label}</span>
        <span className="truncate text-ink">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-2 shadow-xl sm:right-0 sm:left-auto" role="dialog" aria-label={label}>
          {searchable && (
            <div className="relative mb-1.5">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar"
                aria-label={`Buscar em ${label}`}
                autoFocus
                className="h-9 w-full rounded-xl border border-line bg-surface pl-8 pr-2 text-sm outline-none focus:border-brand-line"
              />
            </div>
          )}
          <ul className="max-h-64 overflow-y-auto" role="listbox" aria-multiselectable="true">
            {shown.map((o) => {
              const on = draft.includes(o.id);
              return (
                <li key={o.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => toggle(o.id)}
                    className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2', on && 'bg-brand-soft/60')}
                  >
                    <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-brand bg-brand text-white' : 'border-line')}>
                      {on && <Check className="h-3 w-3" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{o.name}</span>
                    {o.hint && <span className="shrink-0 text-[9px] text-muted">{o.hint}</span>}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="px-2 py-2 text-xs text-muted">{emptyText}</li>}
          </ul>
          <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-line pt-2">
            <button type="button" onClick={() => setDraft([])} disabled={!draft.length} className="text-xs text-ink-2 hover:text-ink disabled:opacity-40">
              Limpar seleção
            </button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setOpen(false);
                onApply(draft);
              }}
            >
              Aplicar{draft.length ? ` (${draft.length})` : ''}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Filtro da agenda, para todos os usuários: um ou vários usuários (?quem=a,b) e um ou vários setores (?setor=x,y).
 * Quem é do setor entra junto; sem nada escolhido, é a própria agenda. O banco continua mostrando só o que a pessoa
 * já pode ver (compromissos de que participa e demandas dos grupos que enxerga).
 */
export function AgendaFilter({
  meId,
  users,
  sectors,
  selectedUsers,
  selectedSectors,
}: {
  meId: string;
  users: { id: string; name: string }[];
  sectors: { id: string; name: string; count: number }[];
  selectedUsers: string[];
  selectedSectors: string[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const go = (key: 'quem' | 'setor', ids: string[]) => {
    const next = new URLSearchParams(params);
    next.delete('pessoa');
    next.delete('dia');
    next.delete('evento');
    next.set(key, ids.join(','));
    if (!ids.length) next.delete(key);
    router.push(`/agenda${next.size ? `?${next}` : ''}`);
  };
  const clear = () => {
    const next = new URLSearchParams(params);
    for (const k of ['quem', 'setor', 'pessoa', 'dia', 'evento']) next.delete(k);
    router.push(`/agenda${next.size ? `?${next}` : ''}`);
  };
  const userOptions: Option[] = [
    { id: meId, name: 'Minha agenda', hint: 'eu' },
    ...users.filter((u) => u.id !== meId).map((u) => ({ id: u.id, name: u.name })),
  ];
  const active = selectedUsers.length + selectedSectors.length > 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <MultiPick label="Usuários" icon={Users} options={userOptions} selected={selectedUsers} onApply={(ids) => go('quem', ids)} searchable emptyText="Nenhum usuário encontrado." />
      {sectors.length > 0 && (
        <MultiPick
          label="Setores"
          icon={Building2}
          options={sectors.map((s) => ({ id: s.id, name: s.name, hint: `${s.count} pessoa${s.count === 1 ? '' : 's'}` }))}
          selected={selectedSectors}
          onApply={(ids) => go('setor', ids)}
          emptyText="Nenhum setor."
        />
      )}
      {active && (
        <button type="button" onClick={clear} className="inline-flex h-9 items-center gap-1 rounded-xl px-2 text-xs font-medium text-brand-text hover:bg-brand-soft" title="Voltar para a própria agenda">
          <X className="h-3.5 w-3.5" aria-hidden /> Limpar filtros
        </button>
      )}
    </div>
  );
}
