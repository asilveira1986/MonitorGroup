'use client';

import { Check, CheckCheck, Clock, Forward, Loader2, Lock, MessageCircle, Reply } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { markMediaSeen } from '../../actions';
import { Badge, EmptyState } from '@/components/ui';
import { cn, formatDateTime, formatDuration, formatPhone, formatTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { Message, OutgoingMessage } from '@/lib/types';
import { Composer, OutgoingBubble, type ReplyConfig } from './composer';
import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { DemandForm } from '@/components/demands/demand-form';
import { MarkTeamButton, MessageSenderPicker } from '../group-controls';
import { PAGE_SIZE } from './constants';
import { MessageMedia } from './message-media';
import { MessageEditor, MessageMenu } from './message-menu';
import { CallPrivateButton } from '../../private/call-private';
import { ShareDialog, type ShareMode, type ShareSource } from '@/components/share-dialog';
import { useRealtime } from '@/lib/use-realtime';


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

const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document']);
/** pacotes técnicos do WhatsApp (ex.: "secretEncrypted"): nunca aparecem na conversa (o banco também barra, 0064) */
const TECHNICAL_TYPES = new Set([
  'secretEncrypted', 'encEventResponse', 'encComment', 'encReaction', 'pollResultSnapshot', 'placeholder',
  'statusMention', 'protocol', 'reaction', 'senderKeyDistribution', 'messageContextInfo', 'pollUpdate', 'keepInChat', 'pinInChat',
]);
const SEEN_VIA: Record<string, string> = { whatsapp: 'no WhatsApp', painel: 'baixa no painel', resposta: 'equipe respondeu' };

/** Situação de um arquivo do cliente: visto (no celular ou com baixa no painel) ou botão para dar baixa. */
function MediaSeen({ message, timeZone, viewed }: { message: Message; timeZone?: string; viewed?: boolean }) {
  const [state, setSeen] = useState(message.seen_at ? { at: message.seen_at, via: message.seen_via, by: message.seen_by } : null);
  const [busy, startTransition] = useTransition();
  const seen = state ?? (viewed ? { at: new Date().toISOString(), via: 'painel', by: null } : null);
  if (seen) {
    return (
      <span
        className="inline-flex items-center gap-1 text-good-ink"
        title={`Visto ${SEEN_VIA[seen.via ?? ''] ?? ''}${seen.by ? ` · ${seen.by}` : ''} · ${formatDateTime(seen.at, timeZone)}`}
      >
        <CheckCheck className="h-3 w-3" aria-hidden /> visto
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() =>
        startTransition(async () => {
          const r = await markMediaSeen({ messageId: message.id });
          if (r.ok) setSeen({ at: new Date().toISOString(), via: 'painel', by: null });
        })
      }
      className="inline-flex items-center gap-1 rounded-full border border-warning/40 px-1.5 py-0.5 text-warning-ink hover:border-brand-line hover:text-brand-text disabled:opacity-50"
      title="Ninguém viu este arquivo: a conversa não foi lida no celular conectado"
    >
      <CheckCheck className="h-3 w-3" aria-hidden /> dar baixa
    </button>
  );
}

type Receipt = { message_id: string; user_jid: string; delivered_at: string | null; read_at: string | null };

/**
 * Tiques do WhatsApp numa mensagem do número conectado: ✓ enviada, ✓✓ entregue a todos,
 * ✓✓ azul lida por todos. Ao passar o mouse: quantos receberam e leram, e quem leu.
 */
function Ticks({ status, receipts, recipients, nameOf }: { status: number | null | undefined; receipts: Receipt[]; recipients: number; nameOf: (jid: string) => string }) {
  const read = receipts.filter((r) => r.read_at);
  const delivered = receipts.filter((r) => r.delivered_at || r.read_at);
  const total = Math.max(1, recipients);
  const allRead = read.length >= total || (status ?? 0) >= 4;
  const allDelivered = allRead || delivered.length >= total || (status ?? 0) >= 3;
  const sent = allDelivered || (status ?? 0) >= 2 || receipts.length > 0;
  if (!sent) return null;
  const names = read.slice(0, 12).map((r) => nameOf(r.user_jid));
  const title = [
    allRead ? 'Lida por todos' : allDelivered ? 'Entregue a todos' : 'Enviada',
    receipts.length ? `entregue a ${Math.min(delivered.length, total)} de ${total} · lida por ${Math.min(read.length, total)} de ${total}` : null,
    names.length ? `Leram: ${names.join(', ')}${read.length > names.length ? ` e mais ${read.length - names.length}` : ''}` : null,
  ]
    .filter(Boolean)
    .join('\n');
  const Icon = allDelivered ? CheckCheck : Check;
  return (
    <span title={title} aria-label={title} className={cn('inline-flex items-center gap-0.5', allRead ? 'text-sky-500' : 'text-muted')}>
      <Icon className="h-3.5 w-3.5" />
      {!allRead && read.length > 0 && <span className="tabular text-[10px] text-sky-600">{read.length}</span>}
    </span>
  );
}

type Reaction = {
  id: string;
  message_id: string;
  reactor_jid: string;
  reactor_name: string | null;
  reactor_phone: string | null;
  from_team: boolean;
  emoji: string;
};

/** Reações embaixo da mensagem, como no WhatsApp: um selo por emoji, com quem reagiu ao passar o mouse. */
function Reactions({ list, alignEnd }: { list: Reaction[]; alignEnd: boolean }) {
  const byEmoji = new Map<string, Reaction[]>();
  for (const r of list) byEmoji.set(r.emoji, [...(byEmoji.get(r.emoji) ?? []), r]);
  const who = (r: Reaction) => r.reactor_name || formatPhone(r.reactor_phone) || (r.from_team ? 'Equipe' : 'Cliente');
  return (
    <div className={cn('-mt-1.5 flex flex-wrap gap-1 px-2', alignEnd ? 'justify-end' : 'justify-start')} aria-label="Reações">
      {[...byEmoji].map(([emoji, rs]) => (
        <span
          key={emoji}
          title={rs.map(who).join(', ')}
          className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-1.5 py-0.5 text-xs shadow-sm"
        >
          <span aria-hidden>{emoji}</span>
          {rs.length > 1 && <span className="tabular text-[10px] font-semibold text-ink-2">{rs.length}</span>}
          <span className="sr-only">{`${emoji} de ${rs.map(who).join(', ')}`}</span>
        </span>
      ))}
    </div>
  );
}

/** Remove a assinatura "*Nome:*" das respostas do painel: o nome já aparece no balão. */
function withoutSignature(body: string | null, senderName: string | null) {
  if (!body || !senderName) return body;
  const prefix = `*${senderName}:*\n`;
  return body.startsWith(prefix) ? body.slice(prefix.length) : body;
}

/**
 * Menções (@pessoa): o WhatsApp manda o número ou o identificador interno (LID) de quem foi marcado,
 * ex.: "@121839833624806". Troca pelo nome do membro, como no celular; sem o nome, mostra o telefone.
 */
function withMentions(text: string, nameOf: (digits: string) => string | null) {
  const parts = text.split(/(@\d{8,20})\b/g);
  if (parts.length === 1) return text;
  return parts.map((part, i) => {
    if (i % 2 === 0) return part;
    const digits = part.slice(1);
    const name = nameOf(digits);
    return (
      <span key={i} className="font-medium text-series-1" title={name ? `Menção a ${name}` : 'Menção a um membro do grupo'}>
        @{name ?? 'membro do grupo'}
      </span>
    );
  });
}

/** Mais recente primeiro; empate no horário resolvido pelo id (cursor estável). */
const newerFirst = (a: Message, b: Message) =>
  a.sent_at === b.sent_at ? (a.id < b.id ? 1 : -1) : a.sent_at < b.sent_at ? 1 : -1;

/**
 * Conversa do grupo com carregamento sob demanda: abre com as mensagens mais
 * recentes e busca as anteriores, de 50 em 50, ao rolar para o topo.
 */
export function Conversation({
  groupId,
  initial,
  timeZone,
  slaSeconds,
  pendingSince,
  demands,
  reply,
  outgoing,
  contacts,
  participantsCount = 0,
  canPrivate = false,
}: {
  /** "Chamar no privado" ao lado de quem enviou (conversas privadas liberadas) */
  canPrivate?: boolean;
  /** participantes do grupo (a conta dos tiques: entregue/lida por todos, menos o número conectado) */
  participantsCount?: number;
  /** participantes do grupo: completa nome e telefone de quem só veio com um dos dois (ou com LID) */
  contacts?: { jid: string; lid?: string | null; phone: string | null; name: string | null }[];
  reply: ReplyConfig;
  /** respostas do painel ainda na fila, enviando, com falha ou recém-enviadas */
  outgoing: OutgoingMessage[];
  demands: { manualEnabled: boolean; groupName: string; members: { id: string; name: string }[]; types: string[] };
  groupId: string;
  /** mensagens mais recentes, da mais nova para a mais antiga */
  initial: Message[];
  timeZone?: string;
  slaSeconds: number;
  pendingSince: string | null;
}) {
  const [older, setOlder] = useState<Message[]>([]);
  // atualizações das mensagens já na tela (ex.: o arquivo da imagem/áudio terminou de ser guardado)
  const [patches, setPatches] = useState<Map<string, Message>>(new Map());
  // mensagens novas chegando em tempo real: aparecem na hora, sem esperar a tela recarregar
  const [arrived, setArrived] = useState<Map<string, Message>>(new Map());
  // arquivos abertos/tocados agora: contam como vistos
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [demandFrom, setDemandFrom] = useState<Message | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  // encaminhar / responder no privado (0105)
  const [share, setShare] = useState<{ source: ShareSource; mode: ShareMode } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState<Set<string>>(new Set());
  const [hasMore, setHasMore] = useState(initial.length >= PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // junta as mensagens recentes (atualizadas em tempo real) com as antigas já carregadas
  const messages = useMemo(() => {
    const byId = new Map<string, Message>();
    for (const m of [...arrived.values(), ...initial, ...older]) byId.set(m.id, m);
    for (const [id, p] of patches) {
      const m = byId.get(id);
      if (m) byId.set(id, { ...m, ...p });
    }
    return [...byId.values()].filter((m) => !TECHNICAL_TYPES.has(m.message_type) && !m.hidden_at).sort(newerFirst);
  }, [initial, older, patches, arrived]);

  // reações (0062): carregadas para as mensagens na tela e atualizadas em tempo real
  const [reactions, setReactions] = useState<Map<string, Reaction>>(new Map());
  const [receipts, setReceipts] = useState<Map<string, Receipt>>(new Map());
  const receiptsOf = useMemo(() => {
    const map = new Map<string, Receipt[]>();
    for (const r of receipts.values()) map.set(r.message_id, [...(map.get(r.message_id) ?? []), r]);
    return map;
  }, [receipts]);
  const loadedFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    const ids = messages.map((m) => m.id).filter((id) => !loadedFor.current.has(id));
    if (!ids.length) return;
    for (const id of ids) loadedFor.current.add(id);
    const supabase = createClient();
    const mine = messages.filter((m) => m.from_me && ids.includes(m.id)).map((m) => m.id);
    for (let i = 0; i < mine.length; i += 100) {
      void supabase
        .from('message_receipts')
        .select('message_id, user_jid, delivered_at, read_at')
        .in('message_id', mine.slice(i, i + 100))
        .then(({ data, error }) => {
          if (error || !data?.length) return;
          setReceipts((prev) => {
            const next = new Map(prev);
            for (const r of data as Receipt[]) next.set(`${r.message_id}|${r.user_jid}`, r);
            return next;
          });
        });
    }
    for (let i = 0; i < ids.length; i += 100) {
      void supabase
        .from('message_reactions')
        .select('id, message_id, reactor_jid, reactor_name, reactor_phone, from_team, emoji')
        .in('message_id', ids.slice(i, i + 100))
        .then(({ data, error }) => {
          if (error || !data?.length) return;
          setReactions((prev) => {
            const next = new Map(prev);
            for (const r of data as Reaction[]) next.set(r.id, r);
            return next;
          });
        });
    }
  }, [messages]);
  const reactionsOf = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions.values()) map.set(r.message_id, [...(map.get(r.message_id) ?? []), r]);
    return map;
  }, [reactions]);

  useRealtime(`conversation-${groupId}`, (channel) =>
    channel
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const m = payload.new as Message;
          if (m?.id) setArrived((prev) => new Map(prev).set(m.id, m));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const m = payload.new as Message;
          setPatches((prev) => new Map(prev).set(m.id, m));
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_receipts', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const r = payload.new as Receipt;
          if (!r?.message_id) return;
          setReceipts((prev) => new Map(prev).set(`${r.message_id}|${r.user_jid}`, r));
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'message_actions', filter: `group_id=eq.${groupId}` },
        (payload) => {
          const a = payload.new as { status: string; action: string; error: string | null };
          if (a.status === 'failed')
            toast.error(a.action === 'edit' ? 'Não foi possível editar no WhatsApp' : 'Não foi possível apagar no WhatsApp', {
              description: a.error ?? undefined,
            });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'message_reactions', filter: `group_id=eq.${groupId}` },
        (payload) => {
          setReactions((prev) => {
            const next = new Map(prev);
            if (payload.eventType === 'DELETE') next.delete((payload.old as { id: string }).id);
            else {
              const r = payload.new as Reaction;
              // trocou o emoji: a reação anterior da mesma pessoa sai
              for (const [id, x] of next) if (x.message_id === r.message_id && x.reactor_jid === r.reactor_jid && id !== r.id) next.delete(id);
              next.set(r.id, r);
            }
            return next;
          });
        },
      ),
  );

  const markViewed = useCallback(
    (m: Message) => {
      if (m.from_team || m.seen_at || viewed.has(m.id)) return;
      setViewed((prev) => new Set(prev).add(m.id));
      void markMediaSeen({ messageId: m.id });
    },
    [viewed],
  );

  const loadOlder = useCallback(async () => {
    if (loading || !hasMore) return;
    const oldest = messages[messages.length - 1];
    if (!oldest) return;
    setLoading(true);
    const { data, error } = await createClient()
      .from('messages')
      .select('*')
      .eq('group_id', groupId)
      .or(`sent_at.lt.${oldest.sent_at},and(sent_at.eq.${oldest.sent_at},id.lt.${oldest.id})`)
      .order('sent_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);
    setLoading(false);
    if (error) return;
    const page = (data ?? []) as Message[];
    setOlder((prev) => [...prev, ...page]);
    if (page.length < PAGE_SIZE) setHasMore(false);
  }, [groupId, hasMore, loading, messages]);

  // carrega automaticamente quando o topo da conversa aparece na tela
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadOlder(), {
      root: scrollRef.current,
      rootMargin: '200px 0px 0px 0px',
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadOlder]);

  const dayFormat = useMemo(() => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone }), [timeZone]);
  const chronological = useMemo(() => [...messages].reverse(), [messages]);
  // a resposta enviada some da fila quando a mensagem dela chega pelo WhatsApp
  const queued = useMemo(() => {
    const arrived = new Set(messages.map((m) => m.wa_message_id));
    return outgoing.filter((o) => !o.wa_message_id || !arrived.has(o.wa_message_id));
  }, [messages, outgoing]);
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  // jid/LID/telefone -> participante
  const people = useMemo(() => {
    const map = new Map<string, { phone: string | null; name: string | null }>();
    for (const c of contacts ?? []) {
      const v = { phone: c.phone, name: c.name };
      map.set(c.jid, v);
      if (c.lid) map.set(c.lid, v);
      if (c.phone) map.set(`tel:${c.phone}`, v);
    }
    return map;
  }, [contacts]);
  const byWaId = useMemo(() => new Map(messages.map((x) => [x.wa_message_id, x])), [messages]);
  const teamNames = useMemo(() => new Map(demands.members.map((t) => [t.id, t.name])), [demands.members]);
  // nome de quem leu (tiques): membros do grupo por jid ou LID
  const receiptName = useCallback(
    (jid: string) => {
      const p = people.get(jid);
      return p?.name || formatPhone(p?.phone ?? null) || formatPhone(jid.split('@')[0]) || 'membro';
    },
    [people],
  );
  // nome de quem foi mencionado: membros do grupo e remetentes desta conversa (por LID, jid ou telefone)
  const mentionName = useMemo(() => {
    const senders = new Map<string, string>();
    for (const m of messages) {
      if (!m.sender_name) continue;
      if (m.sender_jid) senders.set(m.sender_jid.split('@')[0].split(':')[0], m.sender_name);
      if (m.sender_phone) senders.set(m.sender_phone, m.sender_name);
    }
    return (digits: string) => {
      const p = people.get(`${digits}@lid`) ?? people.get(`${digits}@s.whatsapp.net`) ?? people.get(`tel:${digits}`);
      if (p?.name) return p.name;
      if (senders.get(digits)) return senders.get(digits)!;
      if (p?.phone) return formatPhone(p.phone);
      // número de telefone (55 + DDD): mostra formatado
      return /^55\d{10,11}$/.test(digits) ? formatPhone(digits) : null;
    };
  }, [messages, people]);

  return (
    <div>
    {/* flex-col-reverse mantém a rolagem ancorada nas mensagens mais recentes */}
    <div ref={scrollRef} className="chat-wallpaper flex max-h-[65vh] flex-col-reverse overflow-y-auto p-3 sm:max-h-[640px] sm:p-5">
      <div className="space-y-2">
        <div ref={sentinelRef} className="flex justify-center py-1">
          {hasMore ? (
            <button
              onClick={() => void loadOlder()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1.5 text-xs text-ink-2 hover:text-ink"
            >
              {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {loading ? 'Carregando…' : 'Carregar mensagens anteriores'}
            </button>
          ) : (
            messages.length > 0 && <span className="text-[11px] text-muted">Início do histórico registrado</span>
          )}
        </div>

        {messages.length === 0 && (
          <EmptyState
            icon={<Clock />}
            title="Nenhuma mensagem registrada ainda"
            description="As mensagens novas aparecem aqui em tempo real."
          />
        )}

        {chronological.map((m, i) => {
          const day = dayFormat.format(new Date(m.sent_at));
          const showDay = i === 0 || day !== dayFormat.format(new Date(chronological[i - 1].sent_at));
          const who =
            (m.sender_jid ? people.get(m.sender_jid) : undefined) ?? (m.sender_phone ? people.get(`tel:${m.sender_phone}`) : undefined);
          const phone = m.sender_phone || who?.phone || null;
          // da equipe: o nome do cadastro de atendentes; senão o do WhatsApp ou da lista de membros
          const teamName = m.from_team && m.team_member_id ? teamNames.get(m.team_member_id) : undefined;
          const name = teamName || m.sender_name || who?.name || null;
          // o WhatsApp não informou o remetente (0078): dá para indicar à mão quem foi
          const removed = Boolean(m.anonymized_at);
          const unknownSender = !m.from_me && !m.sender_jid && !phone && !removed;
          const sender = removed
            ? m.from_team ? 'Equipe' : 'Cliente'
            : name || formatPhone(phone) || (m.from_me ? 'Número conectado' : unknownSender ? 'Remetente não identificado' : 'Cliente');
          // cliente: nome e telefone juntos (o telefone só some quando já é o próprio nome)
          const showPhone = !m.from_me && phone && name && name.replace(/\D/g, '') !== phone;
          return (
            <div key={m.id}>
              {showDay && (
                <div className="my-3 flex justify-center">
                  <span className="rounded-full bg-surface-2 px-3 py-1 text-[11px] text-muted">{day}</span>
                </div>
              )}
              <div className={cn('flex', m.from_team ? 'justify-end' : 'justify-start')}>
                <div
                  id={`msg-${m.id}`}
                  className={cn(
                    'max-w-[88%] rounded-2xl px-3.5 py-2 text-sm shadow-sm transition-shadow sm:max-w-[80%]',
                    m.from_team ? 'rounded-br-md bg-brand-soft' : 'rounded-bl-md border border-line bg-surface',
                    pendingSince && !m.from_team && m.sent_at >= pendingSince && 'ring-2 ring-warning/60',
                  )}
                >
                  <div className="mb-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 [&>*]:whitespace-nowrap">
                    <span className={cn('text-xs font-semibold', m.from_team ? 'text-brand-text' : 'text-series-1')}>
                      {sender}
                    </span>
                    {showPhone && (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard?.writeText(formatPhone(phone)).then(() => toast.success('Telefone copiado'));
                        }}
                        className="tabular text-[11px] text-muted hover:text-ink"
                        title="Copiar telefone"
                      >
                        {formatPhone(phone)}
                      </button>
                    )}
                    {canPrivate && !m.from_me && (m.sender_jid || phone) && (
                      <CallPrivateButton jid={m.sender_jid} phone={phone} name={name} compact />
                    )}
                    {!m.from_team && m.sender_jid && (
                      <MarkTeamButton jid={m.sender_jid} name={name ?? ''} phone={phone} />
                    )}
                    {unknownSender && demands.members.length > 0 && (
                      <MessageSenderPicker messageId={m.id} members={demands.members} current={m.team_member_id ?? null} />
                    )}
                    {m.demand_id ? (
                      <Link
                        href={`/demands?status=all&id=${m.demand_id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-series-1/12 px-2 py-0.5 text-[10px] font-medium text-series-1 hover:underline"
                      >
                        <ClipboardList className="h-3 w-3" /> demanda
                      </Link>
                    ) : (
                      !m.from_team &&
                      demands.manualEnabled && (
                        <button
                          onClick={() => setDemandFrom(m)}
                          className="text-[11px] text-muted underline-offset-2 hover:text-brand-text hover:underline"
                        >
                          criar demanda
                        </button>
                      )
                    )}
                    {reply.enabled && !m.deleted_at && (
                      <button
                        onClick={() => setReplyTo(m)}
                        className="ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-brand-text"
                        aria-label={`Responder a ${sender}`}
                      >
                        <Reply className="h-3 w-3" /> responder
                      </button>
                    )}
                    {!m.deleted_at && !removed && (reply.enabled || canPrivate) && (
                      <button
                        type="button"
                        onClick={() =>
                          setShare({
                            mode: 'forward',
                            source: { kind: 'group', id: m.id, author: sender, preview: withoutSignature(m.body, m.from_me ? m.sender_name : null) || (TYPE_LABEL[m.message_type] ?? m.message_type) },
                          })
                        }
                        className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-brand-text', !reply.enabled && 'ml-auto')}
                        aria-label="Encaminhar a mensagem"
                        title="Encaminhar para um grupo ou conversa privada"
                      >
                        <Forward className="h-3 w-3" />
                      </button>
                    )}
                    {canPrivate && !m.deleted_at && !m.from_me && m.sender_jid && (
                      <button
                        type="button"
                        onClick={() =>
                          setShare({
                            mode: 'reply-private',
                            source: { kind: 'group', id: m.id, author: sender, preview: withoutSignature(m.body, null) || (TYPE_LABEL[m.message_type] ?? m.message_type) },
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] text-muted hover:bg-surface-2 hover:text-brand-text"
                        aria-label={`Responder ${sender} no privado`}
                        title="Responder no privado (citando esta mensagem)"
                      >
                        <MessageCircle className="h-3 w-3" /> privado
                      </button>
                    )}
                    {reply.enabled && m.from_me && editing !== m.id && (
                      <MessageMenu message={m} onEdit={() => setEditing(m.id)} />
                    )}
                  </div>
                  {m.deleted_at ? (
                    <div className="text-ink-2">
                      <p className="italic">🚫 Mensagem apagada</p>
                      {showDeleted.has(m.id) ? (
                        <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-2 py-1 text-xs text-ink-2">
                          {withoutSignature(m.body, m.from_me ? m.sender_name : null) || (TYPE_LABEL[m.message_type] ?? m.message_type)}
                        </p>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowDeleted((prev) => new Set(prev).add(m.id))}
                          className="mt-0.5 text-[11px] text-muted underline-offset-2 hover:text-ink hover:underline"
                        >
                          ver o que foi apagado
                        </button>
                      )}
                    </div>
                  ) : editing === m.id ? (
                    <MessageEditor
                      message={m}
                      initial={withoutSignature(m.body, m.sender_name) ?? ''}
                      onClose={() => setEditing(null)}
                    />
                  ) : (
                    <>
                      {removed && (
                        <p className="text-xs italic text-muted">🔒 Conteúdo apagado (prazo de guarda / LGPD)</p>
                      )}
                      {m.quoted_wa_id && (() => {
                        // citação como no WhatsApp: quem escreveu e o trecho; clicar leva à original
                        const orig = byWaId.get(m.quoted_wa_id);
                        const qWho = orig
                          ? orig.from_me
                            ? 'Você'
                            : (orig.from_team && orig.team_member_id ? teamNames.get(orig.team_member_id) : null) ||
                              orig.sender_name ||
                              formatPhone(orig.sender_phone) ||
                              'Cliente'
                          : (m.quoted_sender_jid && people.get(m.quoted_sender_jid)?.name) ||
                            formatPhone(m.quoted_sender_jid?.endsWith('@s.whatsapp.net') ? m.quoted_sender_jid.split('@')[0] : null) ||
                            'Mensagem';
                        const qText = orig
                          ? withoutSignature(orig.body, orig.from_me ? orig.sender_name : null) || TYPE_LABEL[orig.message_type] || orig.message_type
                          : m.quoted_body || (m.quoted_type ? (TYPE_LABEL[m.quoted_type] ?? m.quoted_type) : '');
                        const team = orig ? orig.from_team : false;
                        return (
                          <button
                            type="button"
                            onClick={() => {
                              if (!orig) return;
                              const el = document.getElementById(`msg-${orig.id}`);
                              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              el?.classList.add('ring-2', 'ring-brand');
                              setTimeout(() => el?.classList.remove('ring-2', 'ring-brand'), 1600);
                            }}
                            className={cn(
                              'mb-1.5 block w-full rounded-lg border-l-4 bg-black/[0.04] px-2.5 py-1 text-left text-xs dark:bg-white/[0.06]',
                              team ? 'border-brand' : 'border-series-1',
                              orig ? 'cursor-pointer hover:bg-black/[0.07]' : 'cursor-default',
                            )}
                            title={orig ? 'Ir para a mensagem respondida' : undefined}
                          >
                            <span className={cn('block font-semibold', team ? 'text-brand-text' : 'text-series-1')}>{qWho}</span>
                            <span className="line-clamp-2 text-ink-2">{orig?.deleted_at ? '🚫 Mensagem apagada' : qText}</span>
                          </button>
                        );
                      })()}
                      {m.forwarded && (
                        <p className="mb-0.5 inline-flex items-center gap-1 text-[11px] italic text-muted">
                          <Forward className="h-3 w-3" /> Encaminhada
                        </p>
                      )}
                      <MessageMedia message={m} onViewed={() => markViewed(m)} />
                      <p className="whitespace-pre-wrap break-words text-ink">
                        {m.message_type !== 'text' && !m.media_path && (
                          <span className="text-ink-2">{TYPE_LABEL[m.message_type] ?? m.message_type} </span>
                        )}
                        {withMentions(withoutSignature(m.body, m.from_me ? m.sender_name : null) ?? '', mentionName)}
                      </p>
                    </>
                  )}
                  <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-muted">
                    {m.closes_conversation && (
                      <Badge tone="good" className="py-0 text-[10px]">
                        <Lock className="h-3 w-3" /> encerrou a conversa
                      </Badge>
                    )}
                    {!m.from_team && MEDIA_TYPES.has(m.message_type) && <MediaSeen message={m} timeZone={timeZone} viewed={viewed.has(m.id)} />}
                    {m.response_time_seconds != null && (
                      <Badge tone={m.response_time_seconds <= slaSeconds ? 'good' : 'critical'} className="py-0 text-[10px]">
                        respondeu em {formatDuration(m.response_time_seconds)}
                      </Badge>
                    )}
                    {m.edited_at && !m.deleted_at && (
                      <span
                        className="italic"
                        title={m.original_body ? `Antes: ${withoutSignature(m.original_body, m.sender_name)}` : 'Mensagem editada'}
                      >
                        editada
                      </span>
                    )}
                    <span className="tabular">{formatTime(m.sent_at, timeZone)}</span>
                    {m.from_me && !m.deleted_at && (
                      <Ticks
                        status={m.wa_status}
                        receipts={receiptsOf.get(m.id) ?? []}
                        recipients={participantsCount - 1}
                        nameOf={receiptName}
                      />
                    )}
                  </div>
                </div>
              </div>
              {reactionsOf.get(m.id)?.length ? <Reactions list={reactionsOf.get(m.id)!} alignEnd={m.from_team} /> : null}
              {m.closes_conversation && (
                <div className="my-3 flex items-center gap-2 text-[11px] text-good-ink" role="separator">
                  <span className="h-px flex-1 bg-good/30" />
                  <Lock className="h-3 w-3" /> Conversa encerrada · a próxima mensagem do cliente inicia uma nova
                  <span className="h-px flex-1 bg-good/30" />
                </div>
              )}
            </div>
          );
        })}

        {queued.map((o) => (
          <OutgoingBubble key={o.id} item={o} quoted={o.quoted_message_id ? byId.get(o.quoted_message_id) : undefined} />
        ))}
      </div>
    </div>
      <Composer groupId={groupId} config={reply} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
      {share && (
        <ShareDialog source={share.source} mode={share.mode} canPrivate={canPrivate} canGroup={reply.enabled} onClose={() => setShare(null)} />
      )}
      {demandFrom && (
        <DemandForm
          groups={[]}
          members={demands.members}
          types={demands.types}
          initial={{
            groupId,
            messageId: demandFrom.id,
            description: demandFrom.body ?? '',
            groupName: demands.groupName,
          }}
          onClose={() => setDemandFrom(null)}
        />
      )}
    </div>
  );
}
