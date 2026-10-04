'use client';

import { CheckCircle2, ExternalLink, Loader2, MessageSquareWarning, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { registerFollowup, updateDemand } from '@/app/(app)/demands/actions';
import { Button, Field, Input, Select, Toggle } from '@/components/ui';
import { DEMAND_SOURCE_LABEL, DEMAND_STATUS_LABEL, formatDateTime, formatDuration } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { DemandEvent, DemandStatus } from '@/lib/types';
import type { DemandRow } from '@/app/(app)/demands/board';
import { DemandStatusBadge } from './status';

type Option = { id: string; name: string };

const EVENT_LABEL: Record<string, (e: DemandEvent) => string> = {
  created: (e) => `Demanda criada (${DEMAND_SOURCE_LABEL[e.to_value ?? ''] ?? e.to_value})`,
  status: (e) => `Status: ${DEMAND_STATUS_LABEL[e.from_value ?? ''] ?? '—'} → ${DEMAND_STATUS_LABEL[e.to_value ?? ''] ?? '—'}`,
  assigned: (e) => `Responsável: ${e.from_value ?? '—'} → ${e.to_value ?? '—'}`,
  promised: (e) => `Prazo prometido: ${e.to_value ? formatDateTime(e.to_value) : 'removido'}`,
  edited: (e) => (e.from_value === 'descrição' ? 'Descrição alterada' : `Tipo: ${e.from_value ?? '—'} → ${e.to_value ?? '—'}`),
  followup: (e) => `Cliente cobrou (${e.to_value}ª vez)`,
  reopened: () => 'Reaberta após a entrega (retrabalho)',
  confirmed: () => 'Cliente confirmou o recebimento',
  unconfirmed: () => 'Confirmação removida',
};

const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function DemandDrawer({
  demand,
  members,
  types,
  timeZone,
  onClose,
}: {
  demand: DemandRow;
  members: Option[];
  types: string[];
  timeZone: string;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<DemandEvent[] | null>(null);
  const [origin, setOrigin] = useState<{ body: string | null; sender_name: string | null; sent_at: string } | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    void supabase
      .from('demand_events')
      .select('*')
      .eq('demand_id', demand.id)
      .order('id')
      .then(({ data }) => setEvents((data ?? []) as DemandEvent[]));
    if (demand.origin_message_id) {
      void supabase
        .from('messages')
        .select('body, sender_name, sent_at')
        .eq('id', demand.origin_message_id)
        .maybeSingle()
        .then(({ data }) => setOrigin(data));
    }
  }, [demand.id, demand.origin_message_id, demand.updated_at]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = (changes: Parameters<typeof updateDemand>[1], ok: string) =>
    start(async () => {
      const res = await updateDemand(demand.id, changes);
      if (res.ok) toast.success(ok);
      else toast.error(res.error);
    });

  const overdue = demand.promised_at && !['entregue', 'cancelada'].includes(demand.status) && new Date(demand.promised_at) < new Date();

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`Demanda #${demand.number}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col bg-surface shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="text-xs text-muted">
              Demanda #{demand.number} · {demand.group_name} · {DEMAND_SOURCE_LABEL[demand.source]}
            </p>
            <h2 className="mt-0.5 break-words text-lg font-semibold">{demand.description}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <DemandStatusBadge status={demand.status} />
              {overdue && <span className="text-xs font-medium text-critical-ink">Prazo vencido</span>}
              {demand.followups_count > 0 && (
                <span className="text-xs text-ink-2">{demand.followups_count} cobrança(s)</span>
              )}
              {demand.reopened_count > 0 && (
                <span className="text-xs text-ink-2">reaberta {demand.reopened_count}x</span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 sm:px-6">
          {origin && (
            <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
              <p className="text-xs text-muted">
                Mensagem de origem · {origin.sender_name ?? 'Cliente'} · {formatDateTime(origin.sent_at, timeZone)}
              </p>
              <p className="mt-1 whitespace-pre-wrap">{origin.body ?? '[mídia]'}</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Select
                value={demand.status}
                disabled={pending}
                onChange={(e) => save({ status: e.target.value as DemandStatus }, 'Status atualizado')}
              >
                {Object.entries(DEMAND_STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Responsável">
              <Select
                value={demand.assignee_id ?? ''}
                disabled={pending}
                onChange={(e) => save({ assignee_id: e.target.value || null }, 'Responsável atualizado')}
              >
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo">
              <Select
                value={demand.type ?? ''}
                disabled={pending}
                onChange={(e) => save({ type: e.target.value || null }, 'Tipo atualizado')}
              >
                <option value="">—</option>
                {[...new Set([...types, ...(demand.type ? [demand.type] : [])])].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </Select>
            </Field>
            <Field label="Prazo prometido">
              <Input
                type="datetime-local"
                suppressHydrationWarning
                defaultValue={toLocalInput(demand.promised_at)}
                disabled={pending}
                onBlur={(e) => {
                  const v = e.target.value ? new Date(e.target.value).toISOString() : null;
                  if (v !== (demand.promised_at ? new Date(demand.promised_at).toISOString() : null))
                    save({ promised_at: v }, 'Prazo atualizado');
                }}
              />
            </Field>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted">Aberta em</dt>
              <dd>{formatDateTime(demand.opened_at, timeZone)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Entregue em</dt>
              <dd>{formatDateTime(demand.delivered_at, timeZone)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Tempo de resolução</dt>
              <dd>
                {demand.delivered_at
                  ? formatDuration((new Date(demand.delivered_at).getTime() - new Date(demand.opened_at).getTime()) / 1000)
                  : '—'}
              </dd>
            </div>
          </dl>

          <div className="flex flex-wrap items-center gap-3">
            {demand.status === 'entregue' && (
              <Toggle
                checked={Boolean(demand.confirmed_at)}
                disabled={pending}
                onChange={(v) => save({ confirmed: v }, v ? 'Confirmação registrada' : 'Confirmação removida')}
                label={
                  <span className="inline-flex items-center gap-1.5 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-muted" /> Cliente confirmou o recebimento
                  </span>
                }
              />
            )}
            {['aberta', 'em_andamento'].includes(demand.status) && (
              <Button
                size="sm"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const res = await registerFollowup(demand.id);
                    if (res.ok) toast.success('Cobrança registrada');
                    else toast.error(res.error);
                  })
                }
              >
                <MessageSquareWarning className="h-3.5 w-3.5" /> Registrar cobrança do cliente
              </Button>
            )}
            <Link
              href={`/groups/${demand.group_id}`}
              className="inline-flex items-center gap-1 text-sm text-brand hover:underline"
            >
              Abrir conversa <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">Linha do tempo</h3>
            {!events ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </p>
            ) : (
              <ol className="relative space-y-3 border-l border-line pl-4">
                {events.map((e) => (
                  <li key={e.id} className="text-sm">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand" aria-hidden />
                    <p>{(EVENT_LABEL[e.kind] ?? (() => e.kind))(e)}</p>
                    <p className="text-xs text-muted">
                      {e.actor_label ?? 'Painel'} · {formatDateTime(e.created_at, timeZone)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
