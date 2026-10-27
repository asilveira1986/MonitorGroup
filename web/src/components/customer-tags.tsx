'use client';

import { Check, Plus, Tag, X } from 'lucide-react';
import { useEffect, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { createCustomerTag, setCustomerTags } from '@/app/(app)/tag-actions';
import { AGENDA_COLORS, type AgendaColor } from '@/lib/agenda-colors';

export type CustomerTag = { id: string; name: string; color: AgendaColor };

const hexOf = (c: string) => AGENDA_COLORS[c as AgendaColor]?.hex ?? AGENDA_COLORS.blue.hex;
const COLORS = Object.keys(AGENDA_COLORS) as AgendaColor[];

/** Etiquetas (só mostrar): bolinhas coloridas com o nome. */
export function TagChips({ ids, all, size = 'sm' }: { ids: string[] | null | undefined; all: CustomerTag[]; size?: 'xs' | 'sm' }) {
  const tags = (ids ?? []).map((id) => all.find((t) => t.id === id)).filter((t): t is CustomerTag => Boolean(t));
  if (!tags.length) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span
          key={t.id}
          className={`inline-flex items-center gap-1 rounded-full font-medium text-ink ${size === 'xs' ? 'px-1.5 text-[10px] leading-4' : 'px-2 py-0.5 text-[11px]'}`}
          style={{ backgroundColor: `${hexOf(t.color)}24`, boxShadow: `inset 0 0 0 1px ${hexOf(t.color)}55` }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: hexOf(t.color) }} aria-hidden />
          {t.name}
        </span>
      ))}
    </span>
  );
}

/**
 * Etiquetas de um grupo ou de uma conversa privada (0103): mostra as etiquetas e, para quem pode
 * alterar, o "+ Etiqueta" para marcar/desmarcar e criar uma nova na hora.
 */
export function TagEditor({
  kind,
  targetId,
  value,
  all,
  canEdit,
}: {
  kind: 'group' | 'private';
  targetId: string;
  value: string[];
  all: CustomerTag[];
  canEdit: boolean;
}) {
  const [tags, setTags] = useState(value);
  const [list, setList] = useState(all);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [color, setColor] = useState<AgendaColor>(COLORS[(all.length + 4) % COLORS.length]);
  const [pending, start] = useTransition();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', outside);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', outside);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const save = (next: string[]) => {
    const before = tags;
    setTags(next);
    start(async () => {
      const res = await setCustomerTags(kind, targetId, next);
      if (!res.ok) {
        setTags(before);
        toast.error(res.error);
      } else setTags(res.data);
    });
  };
  const term = q.trim().toLowerCase();
  const shown = list.filter((t) => !term || t.name.toLowerCase().includes(term));
  const exact = list.some((t) => t.name.toLowerCase() === term);
  const create = () =>
    start(async () => {
      const res = await createCustomerTag(q, color);
      if (!res.ok) return void toast.error(res.error);
      if (!list.some((t) => t.id === res.data)) setList([...list, { id: res.data, name: q.trim(), color }].sort((a, b) => a.name.localeCompare(b.name)));
      setQ('');
      setColor(COLORS[(list.length + 5) % COLORS.length]);
      const next = [...new Set([...tags, res.data])];
      setTags(next);
      const saved = await setCustomerTags(kind, targetId, next);
      if (!saved.ok) toast.error(saved.error);
    });

  return (
    <div ref={box} className="relative inline-flex flex-wrap items-center gap-1">
      <TagChips ids={tags} all={list} />
      {canEdit && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:border-brand-line hover:text-ink"
          aria-expanded={open}
        >
          {tags.length ? <Tag className="h-3 w-3" /> : <Plus className="h-3 w-3" />} {tags.length ? 'Etiquetas' : 'Etiqueta'}
        </button>
      )}
      {open && (
        <div className="absolute left-0 top-full z-40 mt-1 w-64 rounded-xl border border-line bg-surface p-2 text-ink shadow-xl">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (term && !exact) create();
                else if (shown[0]) save(tags.includes(shown[0].id) ? tags.filter((x) => x !== shown[0].id) : [...tags, shown[0].id]);
              }
            }}
            placeholder="Buscar ou criar etiqueta"
            maxLength={40}
            autoFocus
            className="mb-1 h-8 w-full rounded-lg border border-line bg-surface px-2 text-base outline-none focus:border-brand-line sm:text-xs"
          />
          <div className="max-h-56 overflow-y-auto">
            {shown.map((t) => {
              const on = tags.includes(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  disabled={pending}
                  onClick={() => save(on ? tags.filter((x) => x !== t.id) : [...tags, t.id])}
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: hexOf(t.color) }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {on && <Check className="h-4 w-4 text-brand-text" />}
                </button>
              );
            })}
            {!shown.length && !term && <p className="px-2 py-1.5 text-xs text-muted">Nenhuma etiqueta ainda: digite um nome para criar.</p>}
          </div>
          {term && !exact && (
            <div className="mt-1 space-y-1.5 border-t border-line pt-2">
              <div className="flex flex-wrap gap-1" role="radiogroup" aria-label="Cor da etiqueta nova">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={color === c}
                    aria-label={AGENDA_COLORS[c].label}
                    onClick={() => setColor(c)}
                    className={`h-5 w-5 rounded-full ${color === c ? 'ring-2 ring-ink ring-offset-1 ring-offset-surface' : ''}`}
                    style={{ backgroundColor: AGENDA_COLORS[c].hex }}
                  />
                ))}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={create}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm font-medium text-brand-text hover:bg-surface-2"
              >
                <Plus className="h-4 w-4" /> Criar “{q.trim()}”
              </button>
            </div>
          )}
          {tags.length > 0 && (
            <button type="button" onClick={() => save([])} className="mt-1 flex w-full items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-2 hover:bg-surface-2">
              <X className="h-3 w-3" /> Tirar todas
            </button>
          )}
        </div>
      )}
    </div>
  );
}
