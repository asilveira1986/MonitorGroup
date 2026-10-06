'use client';

import { Bell, BellOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { Message } from '@/lib/types';
import { useRealtime } from '@/lib/use-realtime';

const STORAGE_KEY = 'notify-messages';

/** Avisos de nova mensagem ligados neste navegador? (padrão: ligados) */
function notifyEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

const TYPE_LABEL: Record<string, string> = {
  image: '📷 Imagem',
  video: '🎬 Vídeo',
  audio: '🎤 Áudio',
  document: '📄 Documento',
  sticker: '🙂 Figurinha',
  contact: '👤 Contato',
  location: '📍 Localização',
};

type AlertItem = {
  groupId: string;
  group: string;
  who: string;
  phone: string | null;
  text: string | null;
  pending: number;
  count: number;
  at: number;
};

/** Bipe curto (dois tons) para chamar a atenção; o navegador pode bloquear até o primeiro clique na página. */
function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.17);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch {
    /* sem áudio */
  }
}

/**
 * Alerta grande no centro da tela a cada mensagem nova de cliente: nome do grupo, quem enviou
 * (nome e número), um trecho da mensagem e quantas mensagens do grupo aguardam resposta.
 * Toca um bipe e faz o título da aba piscar. Fica aberto até alguém fechar ou abrir o grupo;
 * mensagens seguidas do mesmo grupo atualizam o mesmo item, e grupos diferentes entram na lista.
 */
export function MessageNotifier() {
  const router = useRouter();
  const [items, setItems] = useState<AlertItem[]>([]);

  useRealtime('message-notifier', (channel) =>
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      const m = payload.new as Message;
      // só mensagens de clientes, recentes (a importação do histórico não gera aviso)
      if (m.from_team || !notifyEnabled()) return;
      if (Date.now() - new Date(m.sent_at).getTime() > 10 * 60_000) return;

      void createClient()
        .from('groups')
        .select('name, monitored, pending_count')
        .eq('id', m.group_id)
        .maybeSingle()
        .then(({ data: g }) => {
          if (!g || !g.monitored) return;
          const text =
            m.message_type === 'text' ? m.body : `${TYPE_LABEL[m.message_type] ?? m.message_type}${m.body ? ` ${m.body}` : ''}`;
          setItems((prev) => {
            const old = prev.find((i) => i.groupId === m.group_id);
            const item: AlertItem = {
              groupId: m.group_id,
              group: g.name,
              who: m.sender_name || formatPhone(m.sender_phone) || 'Cliente',
              phone: m.sender_name && m.sender_phone ? formatPhone(m.sender_phone) : null,
              text,
              pending: g.pending_count ?? 0,
              count: (old?.count ?? 0) + 1,
              at: Date.now(),
            };
            // o mais recente no topo
            return [item, ...prev.filter((i) => i.groupId !== m.group_id)];
          });
          beep();
        });
    }),
  );

  const open = items.length > 0;
  const close = () => setItems([]);

  // título da aba piscando enquanto o alerta está aberto; Esc fecha
  useEffect(() => {
    if (!open) return;
    const original = document.title;
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 Nova mensagem (${items.length})` : original;
    }, 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setItems([]);
    document.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      document.title = original;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, items.length]);

  if (!open) return null;
  const [first, ...rest] = items;
  const openGroup = (groupId: string) => {
    setItems((prev) => prev.filter((i) => i.groupId !== groupId));
    router.push(`/groups/${groupId}`);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={close}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="msgalert-title"
        onClick={(e) => e.stopPropagation()}
        className="msgalert-box w-full max-w-lg overflow-hidden rounded-3xl border-4 border-brand bg-surface"
      >
        <div className="flex items-center gap-3 bg-brand px-5 py-4 text-brand-ink">
          <span className="msgalert-bell flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Bell className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p id="msgalert-title" className="text-xl font-extrabold uppercase tracking-wide">
              Nova mensagem
            </p>
            <p className="text-sm opacity-90">
              {items.length === 1 ? '1 grupo com mensagem nova' : `${items.length} grupos com mensagens novas`}
            </p>
          </div>
        </div>

        <div className="px-5 py-4">
          <p className="text-2xl font-bold leading-tight text-ink">{first.group}</p>
          <p className="mt-1 text-base font-semibold text-ink-2">
            {first.who}
            {first.phone && <span className="font-normal text-muted"> · {first.phone}</span>}
          </p>
          {first.text && (
            <p className="mt-3 line-clamp-4 rounded-xl bg-surface-2 px-4 py-3 text-base text-ink">{first.text}</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-full bg-critical px-3 py-1 font-semibold text-white">
              {first.pending === 0
                ? 'Nenhuma aguardando resposta'
                : `${first.pending} ${first.pending === 1 ? 'mensagem aguardando' : 'mensagens aguardando'} resposta`}
            </span>
            {first.count > 1 && (
              <span className="rounded-full bg-surface-2 px-3 py-1 font-medium text-ink-2">
                {first.count} mensagens novas neste grupo
              </span>
            )}
          </div>

          {rest.length > 0 && (
            <ul className="mt-4 max-h-40 space-y-1.5 overflow-y-auto border-t border-line pt-3">
              {rest.map((i) => (
                <li key={i.groupId} className="flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold text-ink">{i.group}</span>
                    <span className="text-muted"> · {i.who}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-critical-ink">{i.pending} sem resposta</span>
                  <button
                    type="button"
                    onClick={() => openGroup(i.groupId)}
                    className="shrink-0 rounded-lg border border-line px-2 py-0.5 text-xs font-medium text-ink-2 hover:border-brand hover:text-brand"
                  >
                    Abrir
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
          <button
            type="button"
            onClick={() => openGroup(first.groupId)}
            autoFocus
            className="flex-1 rounded-xl bg-brand px-4 py-3 text-base font-bold text-brand-ink hover:opacity-90"
          >
            Abrir grupo
          </button>
          <button
            type="button"
            onClick={close}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base font-medium text-ink-2 hover:text-ink"
          >
            {items.length > 1 ? 'Fechar todos' : 'Fechar'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Botão do topo para ligar/desligar os avisos de nova mensagem neste navegador. */
export function NotifyToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência guardada no navegador
    setOn(notifyEnabled());
  }, []);
  const toggle = () => {
    const next = !on;
    setOn(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'on' : 'off');
    } catch {}
    toast(next ? 'Avisos de nova mensagem ligados' : 'Avisos de nova mensagem desligados', { duration: 2500 });
  };
  const Icon = on ? Bell : BellOff;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? 'Desligar avisos de nova mensagem' : 'Ligar avisos de nova mensagem'}
      title={on ? 'Avisos de nova mensagem: ligados' : 'Avisos de nova mensagem: desligados'}
      className="rounded-xl p-2 text-ink-2 hover:bg-surface-2 hover:text-ink"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
