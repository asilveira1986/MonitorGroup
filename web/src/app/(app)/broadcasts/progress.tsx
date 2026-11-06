import { totalOf, type StatusCounts } from '@/lib/broadcast';

/** Barra de andamento do disparo: enviados, falhas e o que falta. */
export function Progress({ counts, compact = false }: { counts: StatusCounts; compact?: boolean }) {
  const total = totalOf(counts);
  if (total === 0) return <span className="text-xs text-muted">—</span>;
  const done = counts.sent + counts.failed + counts.skipped;
  const pct = (n: number) => `${(n / total) * 100}%`;
  return (
    <div className="space-y-1">
      <div className="flex h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-inset ring-line" role="img" aria-label={`${done} de ${total} concluídos`}>
        <span className="bg-good" style={{ width: pct(counts.sent) }} />
        <span className="bg-critical" style={{ width: pct(counts.failed) }} />
        <span className="bg-muted/40" style={{ width: pct(counts.skipped) }} />
      </div>
      <p className="text-xs text-muted">
        {counts.sent} de {total} enviados
        {counts.failed > 0 && <span className="text-critical-ink"> · {counts.failed} falha{counts.failed > 1 ? 's' : ''}</span>}
        {!compact && counts.skipped > 0 && <span> · {counts.skipped} não enviados</span>}
      </p>
    </div>
  );
}
