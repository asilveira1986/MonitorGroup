'use client';

import { ChevronDown, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui';
import { ACTIVITY_CATEGORIES } from '@/lib/activity-categories';
import { cn, formatDateTime, timeAgo } from '@/lib/format';
import { recentUserActivity, type UserActivity } from './actions';

/**
 * Um usuário da tela Acompanhamento. Ao clicar, abre as últimas atividades dele no sistema (a lista do Log: o que
 * alterou, respondeu, criou...). Enquanto aberto, atualiza a cada 30 s.
 */
export function UserRow({
  name,
  email,
  roleLabel,
  online,
  lastAccess,
  timeZone,
}: {
  name: string;
  email: string;
  roleLabel: string;
  online: boolean;
  lastAccess: string | null;
  timeZone?: string;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<UserActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [now] = useState(() => Date.now());

  const load = useCallback(async () => {
    setLoading(true);
    const res = await recentUserActivity(email);
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    setItems(res.items);
  }, [email]);

  useEffect(() => {
    if (!open) return;
    // busca ao abrir e, com a aba visível, a cada 30 s
    const first = setTimeout(() => void load(), 0);
    const t = setInterval(() => document.visibilityState === 'visible' && void load(), 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [open, load]);

  const idle = !lastAccess || Date.parse(lastAccess) < now - 7 * 86_400_000;
  return (
    <li className="text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-left hover:bg-surface-2/60"
        title="Ver as últimas atividades deste usuário"
      >
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', online ? 'bg-good' : 'bg-line')} title={online ? 'Online agora' : 'Offline'} />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{name}</span> <span className="text-xs text-muted">{email}</span>
        </span>
        <span className="text-xs text-ink-2">{roleLabel}</span>
        <span className={cn('w-36 text-right text-xs', online ? 'font-medium text-good-ink' : idle ? 'text-warning-ink' : 'text-muted')} suppressHydrationWarning>
          {online ? 'online agora' : lastAccess ? `acessou ${timeAgo(lastAccess)}` : 'nunca acessou'}
        </span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-line bg-surface-2/40 px-3 py-2">
          <div className="mb-1.5 flex items-center gap-2 text-xs text-ink-2">
            <p className="font-semibold">Últimas atividades de {name}</p>
            <button type="button" onClick={() => void load()} disabled={loading} className="ml-auto inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-muted hover:text-ink disabled:opacity-50" title="Atualizar">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            </button>
          </div>
          {error && <p className="text-xs text-critical-ink">{error}</p>}
          {!error && items === null && <p className="text-xs text-muted">Carregando…</p>}
          {!error && items?.length === 0 && (
            <p className="text-xs text-muted">Nenhuma atividade registrada. O registro guarda o que a pessoa faz pelo painel (alterações, respostas enviadas, demandas, alertas) por 180 dias.</p>
          )}
          {!error && items && items.length > 0 && (
            <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line bg-surface">
              {items.map((a, i) => {
                const cat = ACTIVITY_CATEGORIES[a.category] ?? { label: a.category, tone: 'neutral' as const };
                return (
                  <li key={`${a.at}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 text-xs">
                    <span className="tabular w-28 shrink-0 text-muted" suppressHydrationWarning title={formatDateTime(a.at, timeZone)}>
                      {formatDateTime(a.at, timeZone)}
                    </span>
                    <Badge tone={cat.tone}>{cat.label}</Badge>
                    <span className="min-w-0 flex-1 break-words text-ink">{a.summary}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
