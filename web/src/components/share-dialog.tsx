'use client';

import { Forward, Loader2, MessageCircle, Reply, Search, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { forwardMessage, replyInGroup, replyPrivately, type ChatKind } from '@/app/(app)/forward-actions';
import { Button, Textarea } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

type Target = { kind: ChatKind; id: string; name: string; hint: string | null };
export type ShareMode = 'forward' | 'reply-private' | 'reply-group';
export type ShareSource = {
  kind: ChatKind;
  id: string;
  /** trecho da mensagem (para mostrar no topo) */
  preview: string;
  /** quem escreveu (resposta no privado) */
  author?: string | null;
};

/**
 * Encaminhar uma mensagem para um grupo ou conversa privada, responder no privado (mensagem de um
 * grupo) e responder num grupo (mensagem do privado) — 0105.
 */
export function ShareDialog({
  source,
  mode,
  canPrivate,
  canGroup,
  onClose,
}: {
  source: ShareSource;
  mode: ShareMode;
  /** pode usar as conversas privadas */
  canPrivate: boolean;
  /** pode mandar nos grupos pelo painel */
  canGroup: boolean;
  onClose: () => void;
}) {
  const tabs = (mode === 'forward' ? (['private', 'group'] as const) : mode === 'reply-group' ? (['group'] as const) : ([] as const)).filter((k) =>
    k === 'private' ? canPrivate : canGroup,
  );
  const [tab, setTab] = useState<ChatKind>(tabs[0] ?? 'group');
  const [targets, setTargets] = useState<Target[] | null>(mode === 'reply-private' ? [] : null);
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<Target | null>(null);
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ href: string; label: string } | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  useEffect(() => {
    if (mode === 'reply-private') return;
    let alive = true;
    const supabase = createClient();
    void Promise.all([
      canGroup
        ? supabase.from('groups').select('id, name, participants_count').eq('monitored', true).is('removed_at', null).order('last_message_at', { ascending: false, nullsFirst: false }).limit(500)
        : Promise.resolve({ data: [] }),
      canPrivate && mode === 'forward'
        ? supabase.from('private_chats').select('id, name, phone, jid').order('last_message_at', { ascending: false, nullsFirst: false }).limit(500)
        : Promise.resolve({ data: [] }),
    ]).then(([g, p]) => {
      if (!alive) return;
      setTargets([
        ...((g.data ?? []) as { id: string; name: string; participants_count: number }[]).map((r) => ({
          kind: 'group' as const,
          id: r.id,
          name: r.name,
          hint: `${r.participants_count} participantes`,
        })),
        ...((p.data ?? []) as { id: string; name: string | null; phone: string | null; jid: string }[]).map((r) => ({
          kind: 'private' as const,
          id: r.id,
          name: r.name || (r.phone ? `+${r.phone}` : r.jid.split('@')[0]),
          hint: r.name && r.phone ? `+${r.phone}` : null,
        })),
      ]);
    });
    return () => {
      alive = false;
    };
  }, [mode, canGroup, canPrivate]);

  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  const shown = useMemo(
    () =>
      (targets ?? [])
        .filter((t) => t.kind === tab)
        .filter((t) => !term || t.name.toLowerCase().includes(term) || (digits.length >= 3 && (t.hint ?? '').replace(/\D/g, '').includes(digits)))
        .slice(0, 80),
    [targets, tab, term, digits],
  );

  const send = () =>
    start(async () => {
      if (mode === 'forward') {
        if (!chosen) return;
        const res = await forwardMessage(source.kind, source.id, chosen.kind, chosen.id);
        if (!res.ok) return void toast.error(res.error);
        toast.success(`Encaminhada para ${chosen.name}`);
        setDone({ href: chosen.kind === 'group' ? `/groups/${chosen.id}` : `/private?c=${chosen.id}`, label: chosen.name });
      } else if (mode === 'reply-private') {
        const res = await replyPrivately(source.id, text);
        if (!res.ok) return void toast.error(res.error);
        toast.success('Resposta enviada no privado');
        setDone({ href: `/private?c=${res.data}`, label: source.author || 'a conversa privada' });
      } else {
        if (!chosen) return;
        const res = await replyInGroup(source.id, chosen.id, text);
        if (!res.ok) return void toast.error(res.error);
        toast.success(`Resposta enviada em ${chosen.name}`);
        setDone({ href: `/groups/${chosen.id}`, label: chosen.name });
      }
    });

  const title = mode === 'forward' ? 'Encaminhar mensagem' : mode === 'reply-private' ? 'Responder no privado' : 'Responder num grupo';
  const needsText = mode !== 'forward';
  const ready = (mode === 'reply-private' || chosen) && (!needsText || text.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[88dvh] w-full max-w-md flex-col rounded-t-2xl bg-surface text-ink shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            {mode === 'forward' ? <Forward className="h-4 w-4" /> : <Reply className="h-4 w-4" />} {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          <div className="rounded-lg border-l-4 border-brand/70 bg-surface-2 px-2.5 py-1.5 text-xs">
            {source.author && <p className="font-semibold text-brand-text">{source.author}</p>}
            <p className="line-clamp-3 whitespace-pre-wrap text-ink-2">{source.preview}</p>
          </div>

          {done ? (
            <div className="space-y-3 py-2 text-center text-sm">
              <p>✅ Na fila de envio. Sai pelo WhatsApp em alguns segundos.</p>
              <div className="flex justify-center gap-2">
                <Link href={done.href} className="inline-flex h-9 items-center rounded-xl bg-ink px-3 text-xs font-medium text-bg">
                  Abrir {done.label}
                </Link>
                <Button type="button" size="sm" variant="ghost" onClick={onClose}>
                  Fechar
                </Button>
              </div>
            </div>
          ) : (
            <>
              {mode === 'reply-private' ? (
                <p className="text-xs text-ink-2">
                  Vai para a conversa privada com <b>{source.author || 'quem escreveu'}</b>, citando a mensagem do grupo.
                </p>
              ) : (
                <>
                  {tabs.length > 1 && (
                    <div className="inline-flex rounded-xl border border-line p-1 text-xs">
                      {tabs.map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setTab(k);
                            setChosen(null);
                          }}
                          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium ${tab === k ? 'bg-ink text-bg' : 'text-ink-2 hover:text-ink'}`}
                        >
                          {k === 'private' ? <MessageCircle className="h-3.5 w-3.5" /> : <Users className="h-3.5 w-3.5" />}
                          {k === 'private' ? 'Conversas privadas' : 'Grupos'}
                        </button>
                      ))}
                    </div>
                  )}
                  {!tabs.length && <p className="text-sm text-muted">Sem permissão para enviar por aqui.</p>}
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder={tab === 'private' ? 'Buscar conversa ou número' : 'Buscar grupo'}
                      className="h-9 w-full rounded-xl border border-line bg-surface pl-8 pr-2 text-base outline-none focus:border-brand-line sm:text-sm"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-60 overflow-y-auto rounded-xl border border-line">
                    {targets === null ? (
                      <p className="flex items-center gap-2 p-3 text-sm text-muted">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                      </p>
                    ) : shown.length ? (
                      shown.map((t) => (
                        <button
                          key={`${t.kind}${t.id}`}
                          type="button"
                          onClick={() => setChosen(t)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2 ${chosen?.id === t.id ? 'bg-brand-soft' : ''}`}
                        >
                          {t.kind === 'group' ? <Users className="h-4 w-4 shrink-0 text-ink-2" /> : <MessageCircle className="h-4 w-4 shrink-0 text-ink-2" />}
                          <span className="min-w-0 flex-1 truncate">{t.name}</span>
                          {t.hint && <span className="shrink-0 text-[11px] text-muted">{t.hint}</span>}
                        </button>
                      ))
                    ) : (
                      <p className="p-3 text-sm text-muted">Nada encontrado.</p>
                    )}
                  </div>
                </>
              )}
              {needsText && (
                <Textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  maxLength={4000}
                  placeholder="Sua resposta"
                  autoFocus={mode === 'reply-private'}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && ready) {
                      e.preventDefault();
                      send();
                    }
                  }}
                />
              )}
            </>
          )}
        </div>
        {!done && (
          <div className="flex gap-2 border-t border-line px-4 py-3">
            <Button type="button" onClick={send} disabled={pending || !ready}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {mode === 'forward' ? (chosen ? `Encaminhar para ${chosen.name.length > 22 ? `${chosen.name.slice(0, 22)}…` : chosen.name}` : 'Escolha o destino') : 'Enviar'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
