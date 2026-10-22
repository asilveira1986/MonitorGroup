'use client';

import { Activity, Building2, Check, ChevronDown, Headset, MessageCircle, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/format';
import { SETTINGS_NAV, type SettingsCheck } from '@/lib/settings-nav';

export type NavStatus = Partial<Record<SettingsCheck, boolean>> & { whatsappState?: 'connected' | 'connecting' | 'disconnected' | null };

const GROUP_ICON: Record<string, LucideIcon> = {
  Organização: Building2,
  Canais: MessageCircle,
  Atendimento: Headset,
  Monitoramento: Activity,
};

/**
 * Menu das Configurações em dois níveis: os grupos e, só no grupo aberto, os itens. Abre um grupo
 * por vez (o da página atual vem aberto). A descrição de cada item aparece ao passar o mouse.
 */
export function SettingsNav({ isAdmin, status }: { isAdmin: boolean; status: NavStatus }) {
  const pathname = usePathname();
  const groups = SETTINGS_NAV.map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || !i.adminOnly) })).filter((g) => g.items.length);
  const activeGroup = groups.find((g) => g.items.some((i) => i.href === pathname))?.group ?? groups[0].group;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);
  const [lastActive, setLastActive] = useState(activeGroup);
  // trocou de página por outro caminho (link, voltar): abre o grupo dela
  if (activeGroup !== lastActive) {
    setLastActive(activeGroup);
    setOpenGroup(activeGroup);
  }

  const wa = status.whatsappState;
  const waDot = (
    <span
      className={cn('h-2 w-2 shrink-0 rounded-full', wa === 'connected' ? 'bg-good' : wa === 'connecting' ? 'bg-warning' : 'bg-critical')}
      title={wa === 'connected' ? 'WhatsApp conectado' : wa === 'connecting' ? 'WhatsApp conectando' : 'WhatsApp desconectado'}
      aria-label={wa === 'connected' ? 'conectado' : wa === 'connecting' ? 'conectando' : 'desconectado'}
    />
  );

  return (
    <nav aria-label="Configurações" className="lg:sticky lg:top-24 lg:self-start">
      <ul className="space-y-1">
        {groups.map((g) => {
          const Icon = GROUP_ICON[g.group] ?? Building2;
          const open = openGroup === g.group;
          const hasActive = g.group === activeGroup;
          return (
            <li key={g.group}>
              <button
                type="button"
                onClick={() => setOpenGroup(open ? null : g.group)}
                aria-expanded={open}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-surface-2',
                  hasActive ? 'text-ink' : 'text-ink-2',
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', hasActive ? 'text-brand-text' : 'text-muted')} aria-hidden />
                <span className="flex-1">{g.group}</span>
                {!open && g.items.some((i) => i.check === 'whatsapp') && waDot}
                <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition', open && 'rotate-180')} aria-hidden />
              </button>
              {open && (
                <ul className="mb-2 ml-5 mt-0.5 space-y-0.5 border-l border-line pl-3">
                  {g.items.map((i) => {
                    const active = i.href === pathname;
                    const done = i.check && i.check !== 'whatsapp' && status[i.check];
                    return (
                      <li key={i.href}>
                        <Link
                          href={i.href}
                          title={i.description}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm transition',
                            active ? 'bg-brand-soft font-medium text-brand-text' : 'text-ink-2 hover:bg-surface-2 hover:text-ink',
                          )}
                        >
                          <span className="flex-1 truncate">{i.label}</span>
                          {i.check === 'whatsapp' && waDot}
                          {done && <Check className="h-3.5 w-3.5 shrink-0 text-good-ink" aria-label="configurado" />}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
