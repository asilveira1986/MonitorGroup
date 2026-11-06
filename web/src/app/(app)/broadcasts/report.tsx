import { percentOf, type BroadcastReport } from '@/lib/broadcast';
import { Card, CardHeader } from '@/components/ui';

/** Relatório do disparo: enviados, entregues, lidos e respostas (entregue/lido/respondeu valem para pessoas). */
export function Report({ report, series = false }: { report: BroadcastReport; series?: boolean }) {
  const people = report.people;
  const cells: { label: string; value: number; pct: string | null; hint?: string }[] = [
    { label: 'Enviados', value: report.sent, pct: report.total > 0 ? percentOf(report.sent, report.total) : null, hint: 'do total' },
    { label: 'Entregues', value: report.delivered, pct: people > 0 ? percentOf(report.delivered, people) : null, hint: 'das pessoas' },
    { label: 'Lidos', value: report.read, pct: people > 0 ? percentOf(report.read, people) : null, hint: 'das pessoas' },
    { label: 'Responderam', value: report.replied, pct: people > 0 ? percentOf(report.replied, people) : null, hint: 'das pessoas' },
  ];
  return (
    <Card>
      <CardHeader title={series ? 'Relatório (todos os envios da série)' : 'Relatório'} />
      <div className="space-y-3 p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-2 text-sm">
          {cells.map((c) => (
            <div key={c.label} className="rounded-xl bg-surface-2 px-3 py-2">
              <dt className="text-xs text-muted">{c.label}</dt>
              <dd className="text-lg font-semibold text-ink">
                {c.value}
                {c.pct && <span className="ml-1.5 text-xs font-normal text-muted">{c.pct} {c.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
        <p className="text-xs text-muted">
          Entregue, lido e respondeu só aparecem para mensagens a pessoas, e só para quem deixa a confirmação de leitura ligada. Resposta vale até 7 dias depois do envio.
          {report.failed > 0 && ` ${report.failed} falha(s).`}
        </p>
      </div>
    </Card>
  );
}
