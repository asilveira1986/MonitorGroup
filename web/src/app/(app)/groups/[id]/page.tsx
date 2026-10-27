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
import { LiveMessages, MonitorToggle, ResponsiblesSelect, SectorSelect, SlaForm } from '../group-controls';
import { GroupMembers, type GroupMember } from './members';
import { PAGE_SIZE } from './constants';
import type { QuickReply } from '@/lib/quick-replies';
import { Avatar } from '@/components/avatar';
import { TagEditor, type CustomerTag } from '@/components/customer-tags';
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
  const [{ data: members }, { data: typeInd }, { data: outgoing }, { data: canReplyHere }, { data: canDemandsHere }, { data: sectors }, { data: groupMembers }, { data: quickReplies }, { data: closingCfg }, { data: groupPhoto }, { data: canPrivate }, { data: tagRows }] = await Promise.all([
    supabase.from('team_members').select('id, name, active').order('name'),
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
    // "Chamar no privado" (0069): só quem administra a plataforma, com o módulo ligado
    profile.platform_admin ? supabase.rpc('can_use_private_chats') : Promise.resolve({ data: false }),
    // etiquetas de clientes (0103)
    supabase.from('customer_tags').select('id, name, color').order('name'),
  ]);
  const categories = (typeInd?.params as { categories?: { name: string }[] } | undefined)?.categories;
  if (!group) notFound();
  const g = group as Group;
  // responsáveis do grupo (inclui quem foi desativado da equipe, marcado como inativo)
  const allTeam = (members ?? []) as { id: string; name: string; active: boolean }[];
  const responsibleIds: string[] = g.responsible_member_ids?.length ? g.responsible_member_ids : g.responsible_member_id ? [g.responsible_member_id] : [];
  const responsibleNames = responsibleIds.map((rid) => allTeam.find((m) => m.id === rid)?.name ?? 'Responsável');
  const teamOptions = allTeam
    .filter((m) => m.active || responsibleIds.includes(m.id))
    .map((m) => ({ id: m.id, name: m.active ? m.name : `${m.name} (inativo)` }));
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
      ? 'Responder pelo sistema está desligado. Ative em Configurações › Respostas e mensagens.'
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

      <div className="mb-6 flex flex-col gap-4">
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
              {profile.role !== 'admin' && (
                <p className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
                  <Building2 className="h-3.5 w-3.5" /> Setor: {sectors?.find((s) => s.id === g.sector_id)?.name ?? '—'}
                </p>
              )}
              <p
                className={
                  responsibleNames.length
                    ? 'inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand-text'
                    : 'inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted'
                }
              >
                <UserCheck className="h-3.5 w-3.5" /> {responsibleNames.length > 1 ? 'Responsáveis' : 'Responsável'}:{' '}
                {responsibleNames.length ? responsibleNames.join(', ') : 'não definido'}
              </p>
              <TagEditor
                kind="group"
                targetId={g.id}
                value={g.tags ?? []}
                all={(tagRows ?? []) as CustomerTag[]}
                canEdit={!viewer && !g.removed_at}
              />
            </div>
          </div>
        </div>
        {/* perfil "somente ver painéis": sem os controles do grupo */}
        {!g.removed_at && !viewer && (
          <div className="grid gap-4 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)_auto] lg:items-end lg:gap-6">
            <div>
              <p className="mb-1 text-xs font-medium text-ink-2">Monitoramento</p>
              <div className="flex h-9 items-center">
                <MonitorToggle groupId={g.id} monitored={g.monitored} label="Monitorar este grupo" />
              </div>
            </div>
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
                  <UserCheck className="h-3.5 w-3.5" /> Responsáveis pelo grupo (da equipe)
                </p>
                <ResponsiblesSelect groupId={g.id} memberIds={responsibleIds} members={teamOptions} />
                {teamOptions.length === 0 && (
                  <p className="mt-1 text-[11px] text-muted">
                    Cadastre as pessoas em{' '}
                    <Link href="/settings/team" className="underline">
                      Configurações › Atendentes
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
            <GroupMembers members={(groupMembers ?? []) as GroupMember[]} total={g.participants_count} canPrivate={Boolean(canPrivate)} responsibleIds={responsibleIds} />
          </div>
        </div>

        <Card className="lg:col-span-3">
          <CardHeader
            title="Conversa"
            description="Role para cima para ver as anteriores · azul = cliente, verde = equipe"
          />
          <Conversation
            groupId={g.id}
            participantsCount={g.participants_count}
            canPrivate={Boolean(canPrivate)}
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
              members: allTeam.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })),
              types: categories?.length ? categories.map((c) => c.name).filter(Boolean) : DEFAULT_DEMAND_TYPES,
            }}
          />
        </Card>
      </div>

      <GroupFiles groupId={g.id} timeZone={tz} />
    </>
  );
}
