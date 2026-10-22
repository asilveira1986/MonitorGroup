'use client';

import { Activity, Building2, Check, Headset, MessageCircle, type LucideIcon } from 'lucide-react';
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
 * Menu das Configurações em dois níveis, na horizontal: os grupos numa linha e, embaixo, os itens
 * só do grupo clicado (o da página atual vem escolhido). A descrição aparece ao passar o mouse.
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

  const shown = groups.find((g) => g.group === openGroup) ?? groups.find((g) => g.group === activeGroup)!;

  return (
    <nav aria-label="Configurações" className="space-y-2">
      {/* 1º nível: os grupos */}
      <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Grupos das configurações">
        {groups.map((g) => {
          const Icon = GROUP_ICON[g.group] ?? Building2;
          const selected = shown.group === g.group;
          return (
            <button
              key={g.group}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setOpenGroup(g.group)}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition',
                selected ? 'border-brand-line text-ink' : 'border-transparent text-ink-2 hover:text-ink',
              )}
            >
              <Icon className={cn('h-4 w-4', selected ? 'text-brand-text' : 'text-muted')} aria-hidden />
              {g.group}
              {g.items.some((i) => i.check === 'whatsapp') && waDot}
            </button>
          );
        })}
      </div>
      {/* 2º nível: os itens do grupo escolhido */}
      <ul className="flex flex-wrap gap-1.5">
        {shown.items.map((i) => {
          const active = i.href === pathname;
          const done = i.check && i.check !== 'whatsapp' && status[i.check];
          return (
            <li key={i.href}>
              <Link
                href={i.href}
                title={i.description}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition',
                  active
                    ? 'border-brand-line bg-brand-soft font-medium text-brand-text'
                    : 'border-line bg-surface text-ink-2 hover:border-brand-line hover:text-ink',
                )}
              >
                {i.label}
                {i.check === 'whatsapp' && waDot}
                {done && <Check className="h-3.5 w-3.5 text-good-ink" aria-label="configurado" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
