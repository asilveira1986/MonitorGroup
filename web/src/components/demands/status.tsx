import { CheckCircle2, CircleDot, Clock, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { DEMAND_STATUS_LABEL } from '@/lib/format';

const STYLE = {
  aberta: { tone: 'warning' as const, icon: CircleDot },
  em_andamento: { tone: 'info' as const, icon: Clock },
  entregue: { tone: 'good' as const, icon: CheckCircle2 },
  cancelada: { tone: 'neutral' as const, icon: XCircle },
};

export function DemandStatusBadge({ status }: { status: keyof typeof STYLE }) {
  const s = STYLE[status] ?? STYLE.aberta;
  return (
    <Badge tone={s.tone} className="whitespace-nowrap">
      <s.icon className="h-3 w-3" aria-hidden /> {DEMAND_STATUS_LABEL[status]}
    </Badge>
  );
}
