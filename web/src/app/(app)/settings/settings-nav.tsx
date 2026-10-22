'use client';

import { Check, ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/format';
import { SETTINGS_NAV, type SettingsCheck } from '@/lib/settings-nav';

export type NavStatus = Partial<Record<SettingsCheck, boolean>> & { whatsappState?: 'connected' | 'connecting' | 'disconnected' | null };

/**
 * Menu lateral das Configurações: grupos em letra pequena e os itens embaixo, com ✓ no que já foi
 * configurado e o status do WhatsApp. No celular vira uma lista que abre e fecha.
 */
export function SettingsNav({ isAdmin, status }: { isAdmin: boolean; status: NavStatus }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const groups = SETTINGS_NAV.map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || !i.adminOnly) })).filter((g) => g.items.length);
  const current = groups.flatMap((g) => g.items).find((i) => i.href === pathname) ?? groups[0].items[0];

  const wa = status.whatsappState;
  const waDot = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold',
        wa === 'connected' ? 'bg-good/15 text-good-ink' : wa === 'connecting' ? 'bg-warning/15 text-warning-ink' : 'bg-critical/12 text-critical-ink',
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', wa === 'connected' ? 'bg-good' : wa === 'connecting' ? 'bg-warning' : 'bg-critical')} />
      {wa === 'connected' ? 'conectado' : wa === 'connecting' ? 'conectando' : 'desconectado'}
    </span>
  );

  const list = (
    <nav aria-label="Configurações" className="space-y-5">
      {groups.map((g) => (
        <div key={g.group}>
          <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wide text-muted">{g.group}</p>
          <ul className="space-y-0.5">
            {g.items.map((i) => {
              const active = i.href === pathname;
              const done = i.check && i.check !== 'whatsapp' && status[i.check];
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'block rounded-xl px-3 py-2 transition',
                      active ? 'bg-brand-soft ring-1 ring-inset ring-brand-line' : 'hover:bg-surface-2',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <span className={cn('flex-1 text-sm font-medium', active ? 'text-brand-text' : 'text-ink')}>{i.label}</span>
                      {i.check === 'whatsapp' && waDot}
                      {done && <Check className="h-3.5 w-3.5 shrink-0 text-good-ink" aria-label="configurado" />}
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-ink-2">{i.description}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <>
      {/* celular: a seção atual, e a lista ao tocar */}
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-[11px] font-semibold uppercase tracking-wide text-muted">
              {groups.find((g) => g.items.includes(current))?.group}
            </span>
            <span className="block text-sm font-semibold">{current.label}</span>
          </span>
          <ChevronDown className={cn('h-4 w-4 text-muted transition', open && 'rotate-180')} />
        </button>
        {open && <div className="mt-2 rounded-2xl border border-line bg-surface p-2">{list}</div>}
      </div>
      {/* telas grandes: menu fixo à esquerda */}
      <aside className="hidden lg:block">
        <div className="sticky top-24 rounded-2xl border border-line bg-surface p-2">{list}</div>
      </aside>
    </>
  );
}
