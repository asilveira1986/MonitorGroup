import { ArrowLeft, CheckCheck, Hourglass, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/action-button';
import { Card, CardHeader } from '@/components/ui';
import { DEFAULT_DEMAND_TYPES, formatDateTime, formatDuration, formatNumber, REMOVED_REASON_LABEL, timeAgo } from '@/lib/format';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Group, Message } from '@/lib/types';
import { markGroupAnswered } from '../../actions';
import { LiveMessages, MonitorToggle, SlaForm } from '../group-controls';
import { PAGE_SIZE } from './constants';
import { Conversation } from './conversation';
import { DeleteRemovedGroupButton } from '../removed-groups';

export default async function GroupPage({ params }: PageProps<'/groups/[id]'>) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: group }, { data: msgs }, { data: settings }, { data: stats }] = await Promise.all([
    supabase.from('groups').select('*').eq('id', id).maybeSingle(),
    // só as mais recentes; as anteriores são carregadas ao rolar a conversa
    supabase
      .from('messages')
      .select('*')
      .eq('group_id', id)
      .order('sent_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE),
    supabase.from('app_settings').select('timezone, default_sla_minutes, demand_manual_enabled').eq('id', 1).single(),
    // indicadores calculados no banco
    supabase.rpc('group_stats', { p_group_id: id, p_days: 30 }),
  ]);
  const [{ data: members }, { data: typeInd }] = await Promise.all([
    supabase.from('team_members').select('id, name').eq('active', true).order('name'),
    supabase.from('indicators').select('params').eq('key', 'tipo_demanda').maybeSingle(),
  ]);
  const categories = (typeInd?.params as { categories?: { name: string }[] } | undefined)?.categories;
  if (!group) notFound();
  const g = group as Group;
  const tz = settings?.timezone;
  const st = (stats ?? {}) as {
    received?: number;
    sent?: number;
    responses?: number;
    avg_response_seconds?: number | null;
    in_sla?: number;
  };
  const sla = (g.sla_minutes ?? settings?.default_sla_minutes ?? 30) * 60;
  const inSla = st.responses ? ((st.in_sla ?? 0) / st.responses) * 100 : null;

  return (
    <>
      <LiveMessages groupId={g.id} />
      <Link
        href={g.removed_at ? '/groups?filter=removed' : '/groups'}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Grupos
      </Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-base font-semibold text-brand sm:h-14 sm:w-14 sm:text-lg">
            {g.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{g.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
              <Users className="h-4 w-4" /> {g.participants_count} participantes · última atividade {timeAgo(g.last_message_at)}
            </p>
          </div>
        </div>
        {!g.removed_at && (
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <MonitorToggle groupId={g.id} monitored={g.monitored} label="Monitorar este grupo" />
            <div>
              <p className="mb-1 text-xs font-medium text-ink-2">SLA de resposta do grupo</p>
              <SlaForm groupId={g.id} sla={g.sla_minutes} defaultSla={settings?.default_sla_minutes ?? 30} />
            </div>
          </div>
        )}
      </div>

      {g.removed_at && (
        <Card className="mb-4 flex flex-col gap-3 border-critical/40 bg-critical/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-sm">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-critical-ink" />
            <span>
              <strong>Grupo excluído do WhatsApp</strong> em {formatDateTime(g.removed_at, tz)}.{' '}
              {REMOVED_REASON_LABEL[g.removed_reason ?? ''] ?? ''}. O histórico abaixo fica disponível para consulta.
            </span>
          </p>
          {profile.role === 'admin' && <DeleteRemovedGroupButton groupId={g.id} name={g.name} />}
        </Card>
      )}

      {g.pending_since && (
        <Card className="mb-4 flex flex-col gap-3 border-warning/50 bg-warning/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-sm">
            <Hourglass className="h-4 w-4 text-warning-ink" />
            <span>
              <strong>{g.pending_count} mensagem(ns)</strong> de cliente aguardando resposta {timeAgo(g.pending_since)}.
            </span>
          </p>
          <ActionButton action={markGroupAnswered.bind(null, g.id)} success="Marcada como respondida">
            <CheckCheck className="h-3.5 w-3.5" /> Marcar como respondida
          </ActionButton>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="grid grid-cols-2 gap-4 lg:col-span-1 lg:grid-cols-1 lg:content-start">
          {[
            { label: 'Msgs de clientes (30d)', value: formatNumber(st.received) },
            { label: 'Msgs da equipe (30d)', value: formatNumber(st.sent) },
            { label: 'Tempo médio de resposta', value: formatDuration(st.avg_response_seconds) },
            { label: 'Dentro do SLA', value: inSla == null ? '—' : `${inSla.toFixed(0)}%` },
          ].map((k) => (
            <Card key={k.label} className="p-4">
              <p className="text-xs text-ink-2">{k.label}</p>
              <p className="mt-1 text-2xl font-semibold">{k.value}</p>
            </Card>
          ))}
        </div>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Conversa"
            description="Role para cima para ver as anteriores · azul = cliente, verde = equipe"
          />
          <Conversation
            groupId={g.id}
            initial={(msgs ?? []) as Message[]}
            timeZone={tz}
            slaSeconds={sla}
            pendingSince={g.pending_since}
            demands={{
              manualEnabled: settings?.demand_manual_enabled ?? true,
              groupName: g.name,
              members: members ?? [],
              types: categories?.length ? categories.map((c) => c.name).filter(Boolean) : DEFAULT_DEMAND_TYPES,
            }}
          />
        </Card>
      </div>
    </>
  );
}
