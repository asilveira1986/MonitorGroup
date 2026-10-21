import { ArrowLeft, Building2, CheckCheck, Hourglass, Lock, Trash2, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActionButton } from '@/components/action-button';
import { Card, CardHeader } from '@/components/ui';
import { DEFAULT_DEMAND_TYPES, formatDateTime, formatDuration, formatNumber, REMOVED_REASON_LABEL, timeAgo } from '@/lib/format';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Group, Message, OutgoingMessage } from '@/lib/types';
import { markGroupAnswered } from '../../actions';
import { LiveMessages, MonitorToggle, ResponsibleSelect, SectorSelect, SlaForm } from '../group-controls';
import { GroupMembers, type GroupMember } from './members';
import { PAGE_SIZE } from './constants';
import type { QuickReply } from '@/lib/quick-replies';
import { Avatar } from '@/components/avatar';
import { MuteControl } from '@/components/mute-control';
import { Conversation } from './conversation';
import { GroupFiles } from './group-files';
import { DeleteRemovedGroupButton } from '../removed-groups';

const minutesAgo = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export default async function GroupPage({ params, searchParams }: PageProps<'/groups/[id]'>) {
  const { id } = await params;
  // aberto pelo Painel de grupos: o "voltar" leva de volta ao painel
  const fromPanel = (await searchParams).de === 'painel';
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: group }, { data: msgs }, { data: settings }, { data: stats }] = await Promise.all([
    supabase.from('groups').select('*, team_members(name)').eq('id', id).maybeSingle(),
    // só as mais recentes; as anteriores são carregadas ao rolar a conversa
    supabase
      .from('messages')
      .select('*')
      .eq('group_id', id)
      .order('sent_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE),
    supabase
      .from('app_settings')
      .select('timezone, default_sla_minutes, demand_manual_enabled, reply_enabled, reply_sign_name, reply_allowed')
      .single(),
    // indicadores calculados no banco
    supabase.rpc('group_stats', { p_group_id: id, p_days: 30 }),
  ]);
  const recentlySent = minutesAgo(5);
  const [{ data: members }, { data: typeInd }, { data: outgoing }, { data: canReplyHere }, { data: canDemandsHere }, { data: sectors }, { data: groupMembers }, { data: quickReplies }, { data: closingCfg }, { data: groupPhoto }, { data: muteRow }, { data: canMuteHere }] = await Promise.all([
    supabase.from('team_members').select('id, name').eq('active', true).order('name'),
    supabase.from('my_indicators').select('params').eq('key', 'tipo_demanda').maybeSingle(),
    // respostas do painel que ainda não voltaram pelo WhatsApp
    supabase
      .from('outgoing_messages')
      .select('*')
      .eq('group_id', id)
      .or(`status.neq.sent,sent_at.gt.${recentlySent}`)
      .order('created_at'),
    // permissões do setor do grupo para este usuário (administrador: todas)
    supabase.rpc('has_group_permission', { p_group_id: id, p_permission: 'reply' }),
    supabase.rpc('has_group_permission', { p_group_id: id, p_permission: 'demands' }),
    supabase.from('sectors').select('id, name').order('name'),
    // membros do grupo (lista do WhatsApp)
    supabase.rpc('group_members', { p_group_id: id }),
    supabase.from('quick_replies').select('id, shortcut, title, body').order('shortcut'),
    // à parte: sem o script 0043 a coluna não existe e o resto da tela segue normal
    supabase.from('app_settings').select('closing_shortcut').maybeSingle(),
    // imagem do grupo (guardada pelo worker)
    supabase.from('contact_avatars').select('path').eq('jid', group?.jid ?? '').maybeSingle(),
    // silenciar grupo: situação e permissão
    supabase.from('group_mutes').select('muted_until, muted_by_name').eq('group_id', id).maybeSingle(),
    supabase.rpc('has_group_permission', { p_group_id: id, p_permission: 'mute' }),
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
  const canReplyRole = settings?.reply_allowed !== 'admin' || profile.role === 'admin';
  const viewer = profile.role === 'viewer';
  const replyBlocked = viewer
    ? 'Seu perfil é somente para ver os painéis.'
    : !settings?.reply_enabled
    ? profile.role === 'admin'
      ? 'Responder pelo sistema está desligado. Ative em Configurações › Geral.'
      : null
    : !canReplyRole
      ? 'Só administradores podem responder pelo sistema.'
      : canReplyHere === false
        ? 'Seu setor não tem permissão para responder neste grupo.'
        : g.removed_at
        ? 'O número conectado não participa mais deste grupo.'
        : !g.monitored
          ? 'Ative o monitoramento do grupo para responder por aqui.'
          : null;
  const inSla = st.responses ? ((st.in_sla ?? 0) / st.responses) * 100 : null;

  return (
    <>
      <LiveMessages groupId={g.id} />
      <Link
        href={viewer || fromPanel ? '/panel' : g.removed_at ? '/groups?filter=removed' : '/groups'}
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> {viewer || fromPanel ? 'Painel de grupos' : 'Grupos'}
      </Link>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <Avatar
            jid={g.jid}
            hasPhoto={Boolean((groupPhoto as { path?: string | null } | null)?.path)}
            name={g.name}
            fallback={g.name.slice(0, 2).toUpperCase()}
            className="h-12 w-12 rounded-2xl bg-brand-soft text-base text-brand-text sm:h-14 sm:w-14 sm:text-lg"
          />
          <div>
            <h1 className="text-xl font-semibold tracking-tight break-words sm:text-2xl">{g.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-2">
              <Users className="h-4 w-4" />{' '}
              <a href="#membros" className="underline-offset-2 hover:text-ink hover:underline" title="Ver os membros do grupo">
                {g.participants_count} participantes
              </a>{' '}
              · última atividade {timeAgo(g.last_message_at)}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {viewer && (
                <MuteControl groupId={g.id} mutedUntil={(muteRow as { muted_until?: string } | null)?.muted_until ?? null} canMute={false} />
              )}
              {profile.role !== 'admin' && (
                <p className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
                  <Building2 className="h-3.5 w-3.5" /> Setor: {sectors?.find((s) => s.id === g.sector_id)?.name ?? '—'}
                </p>
              )}
              <p
                className={
                  g.team_members?.name
                    ? 'inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text'
                    : 'inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted'
                }
              >
                <UserCheck className="h-3.5 w-3.5" /> Responsável: {g.team_members?.name ?? 'não definido'}
              </p>
            </div>
          </div>
        </div>
        {/* perfil "somente ver painéis": sem os controles do grupo */}
        {!g.removed_at && !viewer && (
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
            <MonitorToggle groupId={g.id} monitored={g.monitored} label="Monitorar este grupo" />
            <MuteControl
              groupId={g.id}
              mutedUntil={(muteRow as { muted_until?: string } | null)?.muted_until ?? null}
              canMute={Boolean(canMuteHere) || profile.platform_admin}
            />
            {profile.role === 'admin' && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-2">
                  <Building2 className="h-3.5 w-3.5" /> Setor (quem vê e atende o grupo)
                </p>
                <SectorSelect groupId={g.id} sectorId={g.sector_id ?? null} sectors={sectors ?? []} />
              </div>
            )}
            {profile.role === 'admin' && (
              <div>
                <p className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-2">
                  <UserCheck className="h-3.5 w-3.5" /> Responsável pelo grupo (da equipe)
                </p>
                <ResponsibleSelect
                  groupId={g.id}
                  memberId={g.responsible_member_id ?? null}
                  members={
                    // inclui o responsável atual mesmo se ele foi desativado da equipe
                    g.responsible_member_id && !(members ?? []).some((m) => m.id === g.responsible_member_id)
                      ? [...(members ?? []), { id: g.responsible_member_id, name: `${g.team_members?.name ?? 'Responsável'} (inativo)` }]
                      : (members ?? [])
                  }
                />
                {(members ?? []).length === 0 && (
                  <p className="mt-1 text-[11px] text-muted">
                    Cadastre as pessoas em{' '}
                    <Link href="/settings/team" className="underline">
                      Configurações › Equipe
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
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

      {!g.pending_since && g.closed_at && (
        <Card className="mb-4 flex items-center gap-2 border-good/40 bg-good/5 p-4 text-sm">
          <Lock className="h-4 w-4 shrink-0 text-good-ink" />
          <span>
            <strong>Conversa encerrada</strong> {timeAgo(g.closed_at)} pela mensagem de fechamento. A próxima mensagem do
            cliente que pedir resposta inicia uma nova conversa (agradecimentos e mensagens configuradas para ignorar não
            reabrem).
          </span>
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
          <div id="membros" className="col-span-2 scroll-mt-20 lg:col-span-1">
            <GroupMembers members={(groupMembers ?? []) as GroupMember[]} total={g.participants_count} />
          </div>
        </div>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Conversa"
            description="Role para cima para ver as anteriores · azul = cliente, verde = equipe"
          />
          <Conversation
            groupId={g.id}
            contacts={(groupMembers ?? []) as { jid: string; lid?: string | null; phone: string | null; name: string | null }[]}
            initial={(msgs ?? []) as Message[]}
            timeZone={tz}
            slaSeconds={sla}
            pendingSince={g.pending_since}
            outgoing={(outgoing ?? []) as OutgoingMessage[]}
            reply={{
              enabled: Boolean(settings?.reply_enabled) && !replyBlocked,
              disabledReason: replyBlocked,
              signName: settings?.reply_sign_name ?? true,
              userName: profile.full_name || profile.email.split('@')[0],
              quickReplies: (quickReplies ?? []) as QuickReply[],
              groupName: g.name,
              closingShortcut: (closingCfg as { closing_shortcut?: string } | null)?.closing_shortcut ?? 'fechamento',
            }}
            demands={{
              manualEnabled: !viewer && (settings?.demand_manual_enabled ?? true) && canDemandsHere !== false,
              groupName: g.name,
              members: members ?? [],
              types: categories?.length ? categories.map((c) => c.name).filter(Boolean) : DEFAULT_DEMAND_TYPES,
            }}
          />
        </Card>
      </div>

      <GroupFiles groupId={g.id} timeZone={tz} />
    </>
  );
}
