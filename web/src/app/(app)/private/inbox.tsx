'use client';

import { AlertCircle, ArrowLeft, Check, CheckCheck, Clock, Loader2, MessageSquarePlus, Mic, Paperclip, Search, Send, UserRound, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, Field, Input, Textarea } from '@/components/ui';
import { cn, formatPhone, formatTime, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { useRealtime } from '@/lib/use-realtime';
import { VoiceRecorder, type VoiceClip } from '@/components/voice-recorder';
import { markPrivateChatRead, preparePrivateUpload, sendPrivateMessage, startPrivateChat, type PrivateMedia as PrivateMediaInput } from './actions';
import {
  PrivateEditor,
  PrivateMedia,
  PrivateMessageMenu,
  PrivateReactions,
  type PrivateMessageRow,
  type PrivateReaction,
} from './message-tools';
import { TagChips, TagEditor, type CustomerTag } from '@/components/customer-tags';

export type PrivateChat = {
  id: string;
  jid: string;
  phone: string | null;
  name: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  /** etiquetas do cliente (0103) */
  tags?: string[];
};
type PrivateMessage = PrivateMessageRow;
type Outgoing = { id: string; chat_id: string; body: string | null; media_name?: string | null; message_type?: string; status: string; error: string | null; created_at: string; wa_message_id: string | null };
type Contact = { jid: string; phone: string | null; name: string | null; notify: string | null };

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

const chatTitle = (c: Pick<PrivateChat, 'name' | 'phone' | 'jid'>) =>
  c.name || formatPhone(c.phone) || (c.jid.endsWith('@lid') ? 'Contato (sem número)' : c.jid.split('@')[0]);
const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w[0] ?? ''))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '#';

/**
 * A mesma pessoa pode vir pelo número (agenda) e pelo LID (grupos): mostra uma vez só,
 * de preferência a linha com o nome salvo e o número.
 */
function uniqueContacts(list: Contact[]) {
  const best = new Map<string, Contact>();
  const score = (c: Contact) => (c.name ? 2 : 0) + (c.jid.endsWith('@s.whatsapp.net') ? 1 : 0);
  for (const c of list) {
    const key = c.phone ?? c.jid;
    const cur = best.get(key);
    if (!cur || score(c) > score(cur)) best.set(key, c);
  }
  return [...best.values()];
}

/** Nova conversa: um contato do WhatsApp (busca) ou um número digitado. */
function NewChatDialog({ onClose, onOpen }: { onClose: () => void; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [pending, start] = useTransition();

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  // busca nos contatos sincronizados do WhatsApp (nome salvo, nome no WhatsApp ou número)
  useEffect(() => {
    const term = q.trim();
    const timer = setTimeout(() => {
      let query = createClient().from('wa_contacts').select('jid, phone, name, notify').order('name', { nullsFirst: false }).limit(50);
      if (term) {
        const digits = term.replace(/\D/g, '');
        query = query.or(
          [`name.ilike.%${term}%`, `notify.ilike.%${term}%`, digits.length >= 3 ? `phone.ilike.%${digits}%` : null].filter(Boolean).join(','),
        );
      }
      void query.then(({ data }) => setContacts(uniqueContacts((data ?? []) as Contact[])));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const open = (input: { jid?: string; phone?: string; name?: string }) =>
    start(async () => {
      const res = await startPrivateChat(input);
      if (!res.ok) return void toast.error(res.error);
      onOpen(res.data!.id);
      onClose();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Nova conversa">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-base font-semibold">Nova conversa</h2>
            <p className="text-xs text-ink-2">Escolha um contato ou digite um número.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          className="grid gap-2 border-b border-line p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            open({ phone, name });
          }}
        >
          <Field label="Número (com DDD)">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="51 99999-8888" required />
          </Field>
          <Field label="Nome (opcional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Como aparece aqui" />
          </Field>
          <Button disabled={pending || phone.replace(/\D/g, '').length < 10}>Abrir</Button>
        </form>
        <div className="p-4 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar contato" className="pl-9" aria-label="Buscar contato" autoFocus />
          </div>
        </div>
        <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {contacts === null && (
            <li className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando contatos…
            </li>
          )}
          {contacts?.length === 0 && (
            <li className="px-3 py-3 text-sm text-muted">
              Nenhum contato encontrado. Os contatos aparecem conforme o WhatsApp conectado sincroniza a agenda.
            </li>
          )}
          {contacts?.map((c) => {
            const title = c.name || c.notify || formatPhone(c.phone) || 'Contato';
            return (
              <li key={c.jid}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => open({ jid: c.jid, name: c.name ?? c.notify ?? undefined })}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-surface-2 disabled:opacity-60"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                    {initials(title)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{title}</span>
                    <span className="block truncate text-xs text-muted">
                      {c.phone ? formatPhone(c.phone) : 'sem número'}
                      {c.name && c.notify && c.notify !== c.name ? ` · ${c.notify}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Mensagem citada dentro do balão (resposta). */
function Quoted({ target }: { target: PrivateMessage | undefined }) {
  return (
    <div className="mb-1.5 rounded-lg border-l-4 border-brand/70 bg-black/[0.04] px-2.5 py-1 text-xs dark:bg-white/[0.06]">
      {target ? (
        <>
          <p className="font-semibold text-brand-text">{target.from_me ? 'Você' : target.sender_name || 'Contato'}</p>
          <p className="line-clamp-2 text-ink-2">{target.deleted_at ? '🚫 Mensagem apagada' : target.body || TYPE_LABEL[target.message_type] || target.message_type}</p>
        </>
      ) : (
        <p className="italic text-muted">Mensagem citada (mais antiga)</p>
      )}
    </div>
  );
}

function StatusTicks({ status }: { status: number | null }) {
  if (!status || status < 2) return null;
  const Icon = status >= 3 ? CheckCheck : Check;
  return <Icon className={cn('h-3.5 w-3.5', status >= 4 ? 'text-sky-500' : 'text-muted')} aria-label={status >= 4 ? 'lida' : status >= 3 ? 'entregue' : 'enviada'} />;
}

/** Conversa aberta: mensagens (tempo real), fila de envio e o campo para responder. */
function ChatView({ chat, timeZone, onBack, tags }: { chat: PrivateChat; timeZone: string; onBack: () => void; tags: CustomerTag[] }) {
  const [messages, setMessages] = useState<PrivateMessage[] | null>(null);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [text, setText] = useState('');
  const [pending, start] = useTransition();
  const loadedFor = useRef<string | null>(null);
  const [reactions, setReactions] = useState<Map<string, PrivateReaction>>(new Map());
  const [editing, setEditing] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (loadedFor.current === chat.id) return;
    loadedFor.current = chat.id;
    const supabase = createClient();
    void Promise.all([
      supabase.from('private_messages').select('*').eq('chat_id', chat.id).order('sent_at', { ascending: false }).limit(200),
      supabase
        .from('private_outgoing')
        .select('id, chat_id, body, media_name, message_type, status, error, created_at, wa_message_id')
        .eq('chat_id', chat.id)
        .in('status', ['pending', 'sending', 'failed'])
        .order('created_at'),
      supabase.from('private_reactions').select('id, message_id, reactor_jid, from_me, emoji').eq('chat_id', chat.id),
    ]).then(([m, o, r]) => {
      setMessages(((m.data ?? []) as PrivateMessage[]).reverse());
      setOutgoing((o.data ?? []) as Outgoing[]);
      setReactions(new Map(((r.data ?? []) as PrivateReaction[]).map((x) => [x.id, x])));
    });
    void markPrivateChatRead(chat.id);
  }, [chat.id]);

  useRealtime(`private-chat-${chat.id}`, (channel) =>
    channel
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_messages', filter: `chat_id=eq.${chat.id}` }, (payload) => {
        const m = payload.new as PrivateMessage;
        if (!m?.id) return;
        setMessages((prev) => {
          const list = prev ?? [];
          const i = list.findIndex((x) => x.id === m.id);
          const next = i >= 0 ? list.map((x) => (x.id === m.id ? m : x)) : [...list, m];
          return next.sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1));
        });
        if (!m.from_me) void markPrivateChatRead(chat.id);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_outgoing', filter: `chat_id=eq.${chat.id}` }, (payload) => {
        const o = payload.new as Outgoing;
        if (!o?.id) return;
        setOutgoing((prev) => {
          const rest = prev.filter((x) => x.id !== o.id);
          return o.status === 'sent' ? rest : [...rest, o];
        });
        if (o.status === 'failed') toast.error('Mensagem não enviada', { description: o.error ?? undefined });
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'private_reactions', filter: `chat_id=eq.${chat.id}` }, (payload) => {
        setReactions((prev) => {
          const next = new Map(prev);
          if (payload.eventType === 'DELETE') next.delete((payload.old as { id: string }).id);
          else {
            const r = payload.new as PrivateReaction;
            for (const [id, x] of next) if (x.message_id === r.message_id && x.reactor_jid === r.reactor_jid && id !== r.id) next.delete(id);
            next.set(r.id, r);
          }
          return next;
        });
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'private_actions', filter: `chat_id=eq.${chat.id}` }, (payload) => {
        const a = payload.new as { status: string; error: string | null };
        if (a.status === 'failed') toast.error('Não foi possível fazer no WhatsApp', { description: a.error ?? undefined });
      }),
  );
  const reactionsOf = useMemo(() => {
    const map = new Map<string, PrivateReaction[]>();
    for (const r of reactions.values()) map.set(r.message_id, [...(map.get(r.message_id) ?? []), r]);
    return map;
  }, [reactions]);

  const [file, setFile] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const [replyTo, setReplyTo] = useState<PrivateMessage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > 50 * 1024 * 1024) return void toast.error('O arquivo passa de 50 MB.');
    setFile(f);
  };
  const send = () => {
    const body = text.trim();
    if (!body && !file) return;
    const sending = file;
    const quotedId = replyTo?.id ?? null;
    setText('');
    setFile(null);
    setReplyTo(null);
    start(async () => {
      let media: PrivateMediaInput | null = null;
      if (sending) {
        // o arquivo vai direto para o Storage (link de upload da conversa) e o worker envia
        const mime = sending.type || 'application/octet-stream';
        const prep = await preparePrivateUpload(chat.id, { name: sending.name, mime, size: sending.size });
        if (!prep.ok) return void toast.error(prep.error);
        const up = await createClient().storage.from('media').uploadToSignedUrl(prep.data!.path, prep.data!.token, sending, { contentType: mime });
        if (up.error) return void toast.error('Não foi possível enviar o arquivo', { description: up.error.message });
        const type = mime.startsWith('image/') && !mime.includes('svg') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'document';
        media = { path: prep.data!.path, type, mime, name: sending.name, size: sending.size };
      }
      const res = await sendPrivateMessage(chat.id, body, { quotedId, media });
      if (!res.ok) {
        setText(body);
        setFile(sending);
        toast.error(res.error);
      }
    });
  };

  // áudio gravado: sobe para o Storage e vai como mensagem de voz
  const sendVoice = async (clip: VoiceClip) => {
    const name = `audio.${clip.ext}`;
    const prep = await preparePrivateUpload(chat.id, { name, mime: clip.mime, size: clip.blob.size });
    if (!prep.ok) {
      toast.error(prep.error);
      return false;
    }
    const up = await createClient().storage.from('media').uploadToSignedUrl(prep.data!.path, prep.data!.token, clip.blob, { contentType: clip.mime });
    if (up.error) {
      toast.error('Não foi possível enviar o áudio', { description: up.error.message });
      return false;
    }
    const res = await sendPrivateMessage(chat.id, '', {
      quotedId: replyTo?.id ?? null,
      media: { path: prep.data!.path, type: 'audio', mime: clip.mime, name, size: clip.blob.size, voice: true },
    });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }
    setReplyTo(null);
    return true;
  };

  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);
  const sentIds = useMemo(() => new Set((messages ?? []).map((m) => m.wa_message_id)), [messages]);
  const queue = outgoing.filter((o) => !o.wa_message_id || !sentIds.has(o.wa_message_id));
  const dayFormat = useMemo(() => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone }), [timeZone]);
  const title = chatTitle(chat);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" onClick={onBack} className="rounded-lg p-1 text-ink-2 hover:bg-surface-2 md:hidden" aria-label="Voltar para a lista">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-text">
          {initials(title)}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{title}</p>
          <p className="truncate text-xs text-muted">{chat.phone ? formatPhone(chat.phone) : 'número não informado pelo WhatsApp'}</p>
          <div className="mt-1">
            <TagEditor key={(chat.tags ?? []).join()} kind="private" targetId={chat.id} value={chat.tags ?? []} all={tags} canEdit />
          </div>
        </div>
      </div>

      <div className="chat-wallpaper flex min-h-0 flex-1 flex-col-reverse overflow-y-auto p-3 sm:p-5">
        <div className="space-y-2">
          {messages === null ? (
            <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </p>
          ) : messages.length === 0 && queue.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">Nenhuma mensagem ainda. Escreva abaixo para iniciar a conversa.</p>
          ) : null}
          {(messages ?? []).filter((m) => !m.hidden_at).map((m, i, all) => {
            const day = dayFormat.format(new Date(m.sent_at));
            const showDay = i === 0 || day !== dayFormat.format(new Date(all[i - 1].sent_at));
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="my-3 flex justify-center">
                    <span className="rounded-full bg-surface px-3 py-1 text-[11px] text-muted shadow-sm">{day}</span>
                  </div>
                )}
                <div className={cn('flex', m.from_me ? 'justify-end' : 'justify-start')}>
                  <div
                    className={cn(
                      'relative max-w-[85%] rounded-2xl py-2 pl-3.5 pr-7 text-sm shadow-sm sm:max-w-[75%]',
                      m.from_me ? 'rounded-br-md bg-brand-soft' : 'rounded-bl-md border border-line bg-surface',
                    )}
                  >
                    {editing !== m.id && (
                      <span className="absolute right-1.5 top-1.5">
                        <PrivateMessageMenu
                          message={m}
                          myReaction={(reactionsOf.get(m.id) ?? []).find((r) => r.from_me)?.emoji ?? null}
                          onEdit={() => setEditing(m.id)}
                          onReply={() => setReplyTo(m)}
                        />
                      </span>
                    )}
                    {m.from_me && m.sender_name && <p className="mb-0.5 text-[11px] font-semibold text-brand-text">{m.sender_name}</p>}
                    {m.deleted_at ? (
                      <div className="text-ink-2">
                        <p className="italic">🚫 Mensagem apagada</p>
                        {showDeleted.has(m.id) ? (
                          <p className="mt-1 whitespace-pre-wrap break-words rounded-lg bg-surface-2 px-2 py-1 text-xs">
                            {m.body || (TYPE_LABEL[m.message_type] ?? m.message_type)}
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
                      <PrivateEditor message={m} onClose={() => setEditing(null)} />
                    ) : (
                      <>
                        {m.anonymized_at && <p className="text-xs italic text-muted">🔒 Conteúdo apagado (prazo de guarda / LGPD)</p>}
                        {m.quoted_message_id && <Quoted target={byId.get(m.quoted_message_id)} />}
                        <PrivateMedia message={m} />
                        {/* documento guardado: o nome já aparece no cartão do arquivo */}
                        {!(m.message_type === 'document' && m.media_path) && (
                        <p className="whitespace-pre-wrap break-words">
                          {m.message_type !== 'text' && !m.media_path && (
                            <span className="text-ink-2">{TYPE_LABEL[m.message_type] ?? m.message_type} </span>
                          )}
                          {m.body}
                        </p>
                        )}
                      </>
                    )}
                    <p className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted">
                      {m.edited_at && !m.deleted_at && (
                        <span className="italic" title={m.original_body ? `Antes: ${m.original_body}` : 'Mensagem editada'}>
                          editada
                        </span>
                      )}
                      <span className="tabular">{formatTime(m.sent_at, timeZone)}</span>
                      {m.from_me && !m.deleted_at && <StatusTicks status={m.wa_status} />}
                    </p>
                  </div>
                </div>
                <PrivateReactions list={reactionsOf.get(m.id) ?? []} alignEnd={m.from_me} />
              </div>
            );
          })}
          {queue.map((o) => (
            <div key={o.id} className="flex justify-end">
              <div className={cn('max-w-[85%] rounded-2xl rounded-br-md px-3.5 py-2 text-sm sm:max-w-[75%]', o.status === 'failed' ? 'bg-critical/10' : 'bg-brand-soft/70')}>
                {o.message_type === 'audio' ? (
                  <p className="mb-1 flex items-center gap-1.5 text-xs text-ink-2">
                    <Mic className="h-3.5 w-3.5" /> Áudio
                  </p>
                ) : (
                  o.media_name && (
                    <p className="mb-1 flex items-center gap-1.5 text-xs text-ink-2">
                      <Paperclip className="h-3.5 w-3.5" /> {o.media_name}
                    </p>
                  )
                )}
                {o.body && <p className="whitespace-pre-wrap break-words">{o.body}</p>}
                <p className={cn('mt-1 flex items-center justify-end gap-1 text-[11px]', o.status === 'failed' ? 'text-critical-ink' : 'text-muted')}>
                  {o.status === 'failed' ? (
                    <>
                      <AlertCircle className="h-3.5 w-3.5" /> {o.error ?? 'não enviada'}
                    </>
                  ) : (
                    <>
                      <Clock className="h-3.5 w-3.5" /> enviando…
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(replyTo || file) && (
        <div className="space-y-1.5 border-t border-line bg-surface-2/50 px-3 pt-2">
          {replyTo && (
            <div className="flex items-start gap-2 rounded-lg border-l-4 border-brand bg-surface px-2.5 py-1.5 text-xs">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-brand-text">Respondendo {replyTo.from_me ? 'a você' : title}</p>
                <p className="truncate text-ink-2">{replyTo.body || TYPE_LABEL[replyTo.message_type] || replyTo.message_type}</p>
              </div>
              <button type="button" onClick={() => setReplyTo(null)} className="text-muted hover:text-ink" aria-label="Cancelar resposta">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {file && (
            <div className="flex items-center gap-2 rounded-lg bg-surface px-2.5 py-1.5 text-xs">
              <Paperclip className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate">
                {file.name} <span className="text-muted">· {file.size >= 1048576 ? `${(file.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`}</span>
              </span>
              <span className="text-muted">{text.trim() ? 'com legenda' : 'escreva uma legenda (opcional)'}</span>
              <button type="button" onClick={() => setFile(null)} className="text-muted hover:text-ink" aria-label="Tirar o arquivo">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
      <form
        className="flex items-end gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pickFile(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          ref={fileInput}
          type="file"
          className="hidden"
          onChange={(e) => {
            pickFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        {!recording && (
          <>
            <Button type="button" variant="ghost" onClick={() => fileInput.current?.click()} aria-label="Anexar arquivo" title="Anexar imagem, vídeo, áudio ou documento (até 50 MB)">
              <Paperclip className="h-4 w-4" />
            </Button>
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
                if (e.key === 'Escape') setReplyTo(null);
              }}
              onPaste={(e) => {
                // colar uma imagem (print) anexa o arquivo
                const f = [...(e.clipboardData?.files ?? [])][0];
                if (f) {
                  e.preventDefault();
                  pickFile(f);
                }
              }}
              rows={1}
              maxLength={4000}
              placeholder={file ? 'Legenda (opcional)' : 'Mensagem'}
              aria-label="Mensagem"
              className="max-h-40 min-h-10 flex-1 resize-none"
            />
          </>
        )}
        {/* sem texto nem arquivo, o botão é o microfone (como no WhatsApp) */}
        {recording || (!text.trim() && !file) ? (
          <VoiceRecorder onSend={sendVoice} onActiveChange={setRecording} disabled={pending} />
        ) : (
          <Button type="submit" disabled={pending} aria-label="Enviar">
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

/**
 * Caixa de entrada das conversas privadas: lista à esquerda (busca, não lidas, nova conversa) e a
 * conversa aberta à direita. No celular, uma coisa por vez.
 */
export function PrivateInbox({
  initialChats,
  selectedId,
  timeZone,
  tags = [],
}: {
  initialChats: PrivateChat[];
  selectedId: string | null;
  timeZone: string;
  tags?: CustomerTag[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [chats, setChats] = useState(initialChats);
  const [selected, setSelected] = useState<string | null>(selectedId);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [tagFilter, setTagFilter] = useState('');
  const [lastInitial, setLastInitial] = useState(initialChats);
  if (initialChats !== lastInitial) {
    // a página recarregou (nova conversa criada): usa a lista nova
    setLastInitial(initialChats);
    setChats(initialChats);
  }

  useRealtime('private-chats', (channel) =>
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'private_chats' }, (payload) => {
      const c = payload.new as PrivateChat;
      if (!c?.id) return;
      setChats((prev) => [c, ...prev.filter((x) => x.id !== c.id)]);
    }),
  );

  const choose = useCallback(
    (id: string | null) => {
      setSelected(id);
      if (id) setChats((prev) => prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
      router.replace(id ? `${pathname}?c=${id}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  const list = [...chats]
    .filter((c) => !term || chatTitle(c).toLowerCase().includes(term) || (digits.length >= 3 && (c.phone ?? '').includes(digits)))
    .filter((c) => !tagFilter || (c.tags ?? []).includes(tagFilter))
    .sort((a, b) => ((b.last_message_at ?? '') > (a.last_message_at ?? '') ? 1 : -1));
  const current = chats.find((c) => c.id === selected) ?? null;

  return (
    <Card className="grid h-[calc(100vh-14rem)] min-h-[32rem] overflow-hidden md:grid-cols-[20rem_minmax(0,1fr)]">
      <div className={cn('flex min-h-0 flex-col border-line md:border-r', current && 'hidden md:flex')}>
        <div className="flex items-center gap-2 border-b border-line p-3">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar conversa" className="pl-9" aria-label="Buscar conversa" />
          </div>
          <Button type="button" size="sm" onClick={() => setCreating(true)} aria-label="Nova conversa" title="Nova conversa">
            <MessageSquarePlus className="h-4 w-4" />
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="border-b border-line px-3 py-2">
            <select
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              aria-label="Filtrar por etiqueta"
              className="h-8 w-full rounded-lg border border-line bg-surface px-2 text-base text-ink outline-none focus:border-brand-line sm:text-xs"
            >
              <option value="">Todas as etiquetas</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.length === 0 && (
            <li className="p-6 text-center text-sm text-muted">
              {term || tagFilter ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa ainda. As mensagens no privado aparecem aqui; use o botão + para iniciar uma.'}
            </li>
          )}
          {list.map((c) => {
            const title = chatTitle(c);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => choose(c.id)}
                  className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2', c.id === selected && 'bg-brand-soft/60')}
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand-text">
                    {initials(title)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className={cn('min-w-0 flex-1 truncate text-sm', c.unread_count ? 'font-semibold' : 'font-medium')}>{title}</span>
                      {c.last_message_at && (
                        <span className="shrink-0 text-[11px] text-muted" suppressHydrationWarning>
                          {timeAgo(c.last_message_at)}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-xs text-ink-2">{c.last_message_preview ?? 'sem mensagens'}</span>
                      {c.unread_count > 0 && (
                        <span className="tabular shrink-0 rounded-full bg-good px-1.5 text-[10px] font-semibold text-white">{c.unread_count}</span>
                      )}
                    </span>
                    {(c.tags?.length ?? 0) > 0 && (
                      <span className="mt-0.5 block">
                        <TagChips ids={c.tags} all={tags} size="xs" />
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className={cn('min-h-0', !current && 'hidden md:block')}>
        {current ? (
          <ChatView key={current.id} chat={current} timeZone={timeZone} onBack={() => choose(null)} tags={tags} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted">
            <UserRound className="h-10 w-10" />
            Escolha uma conversa ou inicie uma nova.
            <Button type="button" size="sm" variant="secondary" onClick={() => setCreating(true)}>
              <MessageSquarePlus className="h-4 w-4" /> Nova conversa
            </Button>
          </div>
        )}
      </div>
      {creating && (
        <NewChatDialog
          onClose={() => setCreating(false)}
          onOpen={(id) => {
            router.refresh();
            choose(id);
          }}
        />
      )}
    </Card>
  );
}
