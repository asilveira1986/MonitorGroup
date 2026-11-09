import { Card } from '@/components/ui';

export type GroupStat = {
  /** texto curto, cabe numa linha do card */
  label: string;
  /** texto completo, mostrado ao passar o mouse */
  title?: string;
  value: string;
};

/** Resumo do grupo nos últimos 30 dias: cartões pequenos em duas colunas (ocupam pouco espaço da coluna da esquerda). */
export function GroupStats({ stats }: { stats: GroupStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {stats.map((k) => (
        <Card key={k.label} className="px-3 py-2">
          <p className="truncate text-[11px] leading-tight text-ink-2" title={k.title ?? k.label}>
            {k.label}
          </p>
          <p className="mt-0.5 text-lg font-semibold leading-tight">{k.value}</p>
        </Card>
      ))}
    </div>
  );
}
