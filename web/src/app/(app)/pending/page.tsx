import { AlertOctagon, CheckCheck, Hourglass, PartyPopper } from 'lucide-react';
import Link from 'next/link';
import { ActionButton } from '@/components/action-button';
import { LiveTimer } from '@/components/live-timer';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { cn, formatDateTime, formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { PendingItem } from '@/lib/types';
import { markGroupAnswered } from '../actions';

export default async function PendingPage() {
  const supabase = await createClient();
  const [{ data }, { data: settings }] = await Promise.all([
    supabase.from('pending_queue').select('*'),
    supabase.from('app_settings').select('timezone').eq('id', 1).single(),
  ]);
  const items = (data ?? []) as PendingItem[];
  const overdue = items.filter((i) => i.overdue).length;

  return (
    <>
      <PageHeader
        title="Aguardando resposta"
        description="Conversas em que o cliente escreveu e a equipe ainda não respondeu. A mais antiga aparece primeiro."
        action={
          items.length > 0 && (
            <div className="flex gap-2">
              <Badge tone="warning">
                <Hourglass className="h-3.5 w-3.5" /> {items.length} aguardando
              </Badge>
              {overdue > 0 && (
                <Badge tone="critical">
                  <AlertOctagon className="h-3.5 w-3.5" /> {overdue} fora do SLA
                </Badge>
              )}
            </div>
          )
        }
      />

      {items.length === 0 ? (
        <Card>
          <EmptyState
            icon={<PartyPopper />}
            title="Nenhum cliente aguardando"
            description="Todas as mensagens de clientes nos grupos monitorados foram respondidas."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <Card
              key={item.id}
              className={cn('flex flex-col gap-4 p-4 sm:flex-row sm:items-center', item.overdue && 'border-critical/40')}
            >
              <div
                className={cn(
                  'flex h-14 w-full shrink-0 flex-col items-center justify-center rounded-xl sm:w-24',
                  item.overdue ? 'bg-critical/12 text-critical-ink' : 'bg-warning/15 text-warning-ink',
                )}
              >
                <span className="text-lg font-semibold">
                  <LiveTimer since={item.pending_since} />
                </span>
                <span className="text-[10px] font-medium uppercase tracking-wide">
                  {item.overdue ? 'fora do SLA' : 'esperando'}
                </span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/groups/${item.id}`} className="truncate font-semibold hover:text-brand">
                    {item.name}
                  </Link>
                  <Badge>{item.pending_count} msg</Badge>
                  <span className="text-xs text-muted">SLA {item.sla_minutes} min</span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-ink-2">
                  <span className="font-medium text-ink">
                    {item.pending_sender_name || formatPhone(item.pending_sender_phone) || 'Cliente'}:
                  </span>{' '}
                  {item.pending_body ?? '[mídia]'}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Desde {formatDateTime(item.pending_since, settings?.timezone)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Link
                  href={`/groups/${item.id}`}
                  className="inline-flex h-8 items-center rounded-xl border border-line px-3 text-xs font-medium hover:bg-surface-2"
                >
                  Ver conversa
                </Link>
                <ActionButton action={markGroupAnswered.bind(null, item.id)} success="Conversa marcada como respondida">
                  <CheckCheck className="h-3.5 w-3.5" /> Marcar respondida
                </ActionButton>
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
