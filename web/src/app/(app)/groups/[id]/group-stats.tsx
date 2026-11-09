import type { ReactNode } from 'react';
import { Card } from '@/components/ui';

export type GroupStat = {
  /** texto curto, cabe numa linha do card */
  label: string;
  /** texto completo, mostrado ao passar o mouse */
  title?: string;
  value: string;
};

/**
 * Resumo do grupo nos últimos 30 dias: cartões pequenos, todos numa linha (no celular, dois por linha), alinhados à
 * direita. Ficam na linha do nome do grupo (veja GroupTitleRow).
 */
export function GroupStats({ stats }: { stats: GroupStat[] }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
      {stats.map((k) => (
        <Card key={k.label} className="px-3 py-2 sm:min-w-[7.75rem]">
          <p className="whitespace-nowrap text-[11px] leading-tight text-ink-2" title={k.title ?? k.label}>
            {k.label}
          </p>
          <p className="mt-0.5 text-lg font-semibold leading-tight">{k.value}</p>
        </Card>
      ))}
    </div>
  );
}

/**
 * Linha do título do grupo: o nome (e o que vem junto) à esquerda e o resumo à direita, na mesma linha a partir da tela
 * grande (xl). Em telas menores o resumo desce para uma linha própria, ainda à direita.
 */
export function GroupTitleRow({ children, stats }: { children: ReactNode; stats: GroupStat[] }) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div className="min-w-0">{children}</div>
      <div className="xl:shrink-0">
        <GroupStats stats={stats} />
      </div>
    </div>
  );
}
