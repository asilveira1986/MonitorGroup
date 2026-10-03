import { ArrowLeft, CheckCheck, Clock, Hourglass, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/action-button';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { cn, formatDateTime, formatDuration, formatNumber, formatPhone, formatTime, REMOVED_REASON_LABEL, timeAgo } from '@/lib/format';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Group, Message } from '@/lib/types';
import { markGroupAnswered } from '../../actions';
import { LiveMessages, MarkTeamButton, MonitorToggle, SlaForm } from '../group-controls';
import { DeleteRemovedGroupButton } from '../removed-groups';

const TYPE_LABEL: Record<string, string> = {
  image: '📷 Imagem',
  video: '🎬 Vídeo',
  audio: '🎤 Áudio',
  document: '📄 Documento',
  sticker: '🙂 Figurinha',
  contact: '👤 Contato',
  location: '📍 Localização',
  poll: '📊 Enquete',
};

const daysAgoIso = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

export default async function GroupPage({ params }: PageProps<'/groups/[id]'>) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const since = daysAgoIso(30);
  const [{ data: group }, { data: msgs }, { data: settings }, { data: stats }] = await Promise.all([
    supabase.from('groups').select('*').eq('id', id).maybeSingle(),
    supabase.from('messages').select('*').eq('group_id', id).order('sent_at', { ascending: false }).limit(200),
    supabase.from('app_settings').select('timezone, default_sla_minutes').eq('id', 1).single(),
    supabase
      .from('messages')
      .select('from_team, response_time_seconds')
      .eq('group_id', id)
      .gte('sent_at', since)
      .limit(10000),
  ]);
  if (!group) notFound();
  const g = group as Group;
  const tz = settings?.timezone;
  const messages = ((msgs ?? []) as Message[]).reverse();

  const s = stats ?? [];
  const received = s.filter((m) => !m.from_team).length;
  const sent = s.length - received;
  const times = s.map((m) => m.response_time_seconds).filter((v): v is number => v != null);
  const avg = times.length ? times.reduce((a, b) => a + b, 0) / times.length : null;
  const sla = (g.sla_minutes ?? settings?.default_sla_minutes ?? 30) * 60;
  const inSla = times.length ? (times.filter((t) => t <= sla).length / times.length) * 100 : null;

  const dayFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: tz });
  const rows = messages.map((m, i) => {
    const day = dayFormat.format(new Date(m.sent_at));
    const prev = i > 0 ? dayFormat.format(new Date(messages[i - 1].sent_at)) : null;
    return { m, day, showDay: day !== prev };
  });

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
            { label: 'Msgs de clientes (30d)', value: formatNumber(received) },
            { label: 'Msgs da equipe (30d)', value: formatNumber(sent) },
            { label: 'Tempo médio de resposta', value: formatDuration(avg) },
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
            description="Últimas 200 mensagens · azul = cliente, verde = equipe"
          />
          {/* flex-col-reverse mantém a rolagem ancorada nas mensagens mais recentes */}
          <div className="flex max-h-[70vh] flex-col-reverse overflow-y-auto p-3 sm:max-h-[640px] sm:p-5">
            <div className="space-y-2">
            {messages.length === 0 && (
              <EmptyState icon={<Clock />} title="Nenhuma mensagem registrada ainda" description="As mensagens novas aparecem aqui em tempo real." />
            )}
            {rows.map(({ m, day, showDay }) => {
              const sender = m.sender_name || formatPhone(m.sender_phone) || (m.from_me ? 'Número conectado' : 'Cliente');
              return (
                <div key={m.id}>
                  {showDay && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-full bg-surface-2 px-3 py-1 text-[11px] text-muted">{day}</span>
                    </div>
                  )}
                  <div className={cn('flex', m.from_team ? 'justify-end' : 'justify-start')}>
                    <div
                      className={cn(
                        'max-w-[88%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[80%]',
                        m.from_team
                          ? 'rounded-br-md bg-brand-soft'
                          : 'rounded-bl-md border border-line bg-surface',
                        g.pending_since && !m.from_team && m.sent_at >= g.pending_since && 'ring-2 ring-warning/60',
                      )}
                    >
                      <div className="mb-0.5 flex items-center gap-2">
                        <span className={cn('text-xs font-semibold', m.from_team ? 'text-brand' : 'text-series-1')}>
                          {sender}
                        </span>
                        {!m.from_team && m.sender_jid && (
                          <MarkTeamButton jid={m.sender_jid} name={m.sender_name ?? ''} phone={m.sender_phone} />
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-ink">
                        {m.message_type !== 'text' && (
                          <span className="text-ink-2">{TYPE_LABEL[m.message_type] ?? m.message_type} </span>
                        )}
                        {m.body}
                      </p>
                      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted">
                        {m.response_time_seconds != null && (
                          <Badge tone={m.response_time_seconds <= sla ? 'good' : 'critical'} className="py-0 text-[10px]">
                            respondeu em {formatDuration(m.response_time_seconds)}
                          </Badge>
                        )}
                        <span className="tabular">{formatTime(m.sent_at, tz)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
