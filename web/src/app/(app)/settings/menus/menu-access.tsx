'use client';

import {
  Bell,
  ClipboardList,
  Clock,
  Eye,
  EyeOff,
  FileBarChart,
  LayoutDashboard,
  LayoutGrid,
  MessagesSquare,
  Save,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { cn } from '@/lib/format';
import type { MenuAccess } from '@/lib/menu';
import { saveMenuAccess } from '../actions';

const ICONS: Record<string, LucideIcon> = {
  '/dashboard': LayoutDashboard,
  '/panel': LayoutGrid,
  '/pending': Clock,
  '/demands': ClipboardList,
  '/groups': MessagesSquare,
  '/alerts': Bell,
  '/reports': FileBarChart,
  '/settings': Settings,
};

const OPTIONS: { value: MenuAccess; label: string; icon: LucideIcon }[] = [
  { value: 'all', label: 'Todos', icon: Eye },
  { value: 'admin', label: 'Só administradores', icon: ShieldCheck },
  { value: 'none', label: 'Oculto', icon: EyeOff },
];

type Item = { href: string; label: string; description: string; locked: boolean; access: MenuAccess };

export function MenuAccessForm({ items }: { items: Item[] }) {
  const [access, setAccess] = useState<Record<string, MenuAccess>>(() =>
    Object.fromEntries(items.map((i) => [i.href, i.access])),
  );
  const [pending, start] = useTransition();
  const visibleToAll = items.filter((i) => access[i.href] === 'all').length;

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {items.map((item) => {
          const Icon = ICONS[item.href] ?? LayoutGrid;
          const value = access[item.href];
          return (
            <li key={item.href} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className={cn(
                    'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    value === 'none' ? 'bg-surface-2 text-muted' : 'bg-brand-soft text-brand-text',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className={cn('text-sm font-medium', value === 'none' && 'text-muted line-through')}>{item.label}</p>
                  <p className="text-xs text-muted">
                    {item.description}
                    {item.locked && ' Sempre disponível para administradores.'}
                  </p>
                </div>
              </div>
              <div role="radiogroup" aria-label={`Quem vê ${item.label}`} className="flex shrink-0 gap-1 rounded-xl bg-surface-2 p-1">
                {OPTIONS.filter((o) => !(item.locked && o.value === 'none')).map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={value === o.value}
                    disabled={pending}
                    onClick={() => setAccess({ ...access, [item.href]: o.value })}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition',
                      value === o.value
                        ? o.value === 'none'
                          ? 'bg-surface text-critical-ink shadow-sm'
                          : 'bg-surface text-ink shadow-sm'
                        : 'text-ink-2 hover:text-ink',
                    )}
                  >
                    <o.icon className="h-3.5 w-3.5" aria-hidden />
                    {o.label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await saveMenuAccess(access);
              if (res.ok) toast.success('Menus salvos');
              else toast.error(res.error);
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Salvar menus
        </Button>
        <p className="text-xs text-muted">
          {visibleToAll} de {items.length} menus disponíveis para todos. Vale para todos os usuários desta empresa.
        </p>
      </div>
    </div>
  );
}
