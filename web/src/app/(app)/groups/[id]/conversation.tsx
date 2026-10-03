'use client';

import { Clock, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge, EmptyState } from '@/components/ui';
import { cn, formatDuration, formatPhone, formatTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { Message } from '@/lib/types';
import { MarkTeamButton } from '../group-controls';
import { PAGE_SIZE } from './constants';


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
}: {
  groupId: string;
  /** mensagens mais recentes, da mais nova para a mais antiga */
  initial: Message[];
  timeZone?: string;
  slaSeconds: number;
  pendingSince: string | null;
}) {
  const [older, setOlder] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(initial.length >= PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // junta as mensagens recentes (atualizadas em tempo real) com as antigas já carregadas
  const messages = useMemo(() => {
    const byId = new Map<string, Message>();
    for (const m of [...initial, ...older]) byId.set(m.id, m);
    return [...byId.values()].sort(newerFirst);
  }, [initial, older]);

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

  return (
    // flex-col-reverse mantém a rolagem ancorada nas mensagens mais recentes
    <div ref={scrollRef} className="flex max-h-[70vh] flex-col-reverse overflow-y-auto p-3 sm:max-h-[640px] sm:p-5">
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
                    m.from_team ? 'rounded-br-md bg-brand-soft' : 'rounded-bl-md border border-line bg-surface',
                    pendingSince && !m.from_team && m.sent_at >= pendingSince && 'ring-2 ring-warning/60',
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
                      <Badge tone={m.response_time_seconds <= slaSeconds ? 'good' : 'critical'} className="py-0 text-[10px]">
                        respondeu em {formatDuration(m.response_time_seconds)}
                      </Badge>
                    )}
                    <span className="tabular">{formatTime(m.sent_at, timeZone)}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
