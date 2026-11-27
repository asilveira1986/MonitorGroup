'use client';

import { CheckCircle2, ChevronDown, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, CardHeader } from '@/components/ui';
import { offlineSummary, periodSeconds, reasonText, type ConnectionPeriod } from '@/lib/connection-history';
import { cn, formatDateTime, formatDuration, formatPhone } from '@/lib/format';
import type { Instance } from '@/lib/types';

const WINDOWS = [7, 30];

/**
 * Histórico de desconexões dos números (0195): quando cada número ficou fora do ar, até quando e por quê, mais o resumo dos
 * últimos 7 e 30 dias. Os períodos são gravados pelo banco a cada mudança de situação do número. A lista fica recolhida: abre
 * ao escolher um número (clicar de novo recolhe).
 */
export function ConnectionHistory({
  periods,
  instances,
  timeZone,
  now,
}: {
  periods: ConnectionPeriod[];
  instances: Pick<Instance, 'id' | 'name' | 'phone'>[];
  timeZone?: string;
  now: number;
}) {
  const nameOf = new Map(instances.map((i) => [i.id, i.name || (i.phone ? formatPhone(i.phone) : 'Número')]));
  const [selected, setSelected] = useState<string | null>(null);
  const shown = selected ? periods.filter((p) => p.instance_id === selected) : [];
  return (
    <Card>
      <CardHeader
        title="Histórico de desconexões"
        description="Cada período em que o número ficou fora do ar: quando caiu, quando voltou, quanto durou e o motivo informado pelo WhatsApp."
      />
      <div className="space-y-4 p-4 sm:p-5">
        {instances.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {instances.map((i) => (
              <button
                key={i.id}
                type="button"
                aria-expanded={selected === i.id}
                onClick={() => setSelected((cur) => (cur === i.id ? null : i.id))}
                title={selected === i.id ? 'Recolher as desconexões' : 'Ver as desconexões deste número'}
                className={cn(
                  'rounded-xl border p-3 text-left transition',
                  selected === i.id ? 'border-brand-line bg-brand-soft/40' : 'border-line bg-surface-2/40 hover:border-ink-2',
                )}
              >
                <p className="flex items-center justify-between gap-2 truncate text-sm font-semibold text-ink">
                  <span className="truncate">{nameOf.get(i.id)}</span>
                  <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted transition-transform', selected === i.id && 'rotate-180')} aria-hidden />
                </p>
                <dl className="mt-1.5 space-y-0.5 text-xs text-ink-2">
                  {WINDOWS.map((d) => {
                    const s = offlineSummary(periods, now, d, i.id);
                    return (
                      <div key={d} className="flex items-baseline justify-between gap-2">
                        <dt>Últimos {d} dias</dt>
                        <dd className="tabular text-right">
                          {s.count === 0 ? (
                            <span className="text-good-ink">sem quedas</span>
                          ) : (
                            <>
                              <strong className="text-ink">{formatDuration(s.seconds)}</strong> fora · {s.count} {s.count === 1 ? 'queda' : 'quedas'} ·{' '}
                              {(Math.max(0, 1 - s.share) * 100).toFixed(1).replace('.', ',')}% no ar
                            </>
                          )}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </button>
            ))}
          </div>
        )}
        {instances.length > 0 && !selected && <p className="text-xs text-muted">Clique em um número para ver os períodos em que ele ficou desconectado.</p>}
        {selected && shown.length === 0 && (
          <p className="flex items-center gap-2 rounded-xl bg-surface-2/60 px-3 py-3 text-sm text-ink-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-good-ink" aria-hidden /> Nenhuma desconexão registrada para este número (o registro começa na atualização do banco que ativou este histórico).
          </p>
        )}
        {selected && shown.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Caiu em</th>
                  <th className="py-2 pr-3 font-medium">Voltou em</th>
                  <th className="py-2 pr-3 font-medium">Duração</th>
                  <th className="py-2 font-medium">Motivo</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id} className="border-b border-line/60 align-top last:border-0">
                    <td className="tabular py-2 pr-3 text-ink-2">{formatDateTime(p.started_at, timeZone)}</td>
                    <td className="tabular py-2 pr-3">
                      {p.ended_at ? (
                        <span className="text-ink-2">{formatDateTime(p.ended_at, timeZone)}</span>
                      ) : (
                        <Badge tone="critical">
                          <WifiOff className="h-3 w-3" aria-hidden /> Ainda desconectado
                        </Badge>
                      )}
                    </td>
                    <td className="tabular py-2 pr-3 font-semibold text-ink">{formatDuration(periodSeconds(p, now))}</td>
                    <td className="max-w-md py-2 text-xs text-ink-2">{reasonText(p.reason)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
