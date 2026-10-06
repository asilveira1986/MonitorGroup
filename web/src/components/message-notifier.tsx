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
 * Alerta grande no centro da tela a cada mensagem nova de cliente, só com o grupo e a mensagem:
 * nome do grupo, quem enviou (nome e número) e o texto. Toca um bipe e faz o título da aba piscar.
 * Fica aberto até alguém fechar ou abrir o grupo; uma mensagem nova do mesmo grupo substitui a
 * anterior, e outros grupos aparecem em seguida, um por vez.
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
        .select('name, monitored')
        .eq('id', m.group_id)
        .maybeSingle()
        .then(({ data: g }) => {
          if (!g || !g.monitored) return;
          const text =
            m.message_type === 'text' ? m.body : `${TYPE_LABEL[m.message_type] ?? m.message_type}${m.body ? ` ${m.body}` : ''}`;
          setItems((prev) => {
            const item: AlertItem = {
              groupId: m.group_id,
              group: g.name,
              who: m.sender_name || formatPhone(m.sender_phone) || 'Cliente',
              phone: m.sender_name && m.sender_phone ? formatPhone(m.sender_phone) : null,
              text,
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

  // título da aba piscando enquanto o alerta está aberto; Esc fecha
  useEffect(() => {
    if (!open) return;
    const original = document.title;
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 Nova mensagem (${items.length})` : original;
    }, 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setItems((prev) => prev.slice(1));
    document.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      document.title = original;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, items.length]);

  if (!open) return null;
  // um aviso por vez: o mais recente; ao fechar, aparece o próximo grupo com mensagem nova
  const current = items[0];
  const dismiss = () => setItems((prev) => prev.slice(1));
  const openGroup = () => {
    dismiss();
    router.push(`/groups/${current.groupId}`);
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={dismiss}
      role="presentation"
    >
      <div
        key={current.groupId + current.at}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="msgalert-title"
        onClick={(e) => e.stopPropagation()}
        className="msgalert-box w-full max-w-lg overflow-hidden rounded-3xl border-4 border-brand bg-surface"
      >
        <div className="flex items-center gap-3 bg-brand px-5 py-3.5 text-brand-ink">
          <span className="msgalert-bell flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Bell className="h-5 w-5" aria-hidden />
          </span>
          <p id="msgalert-title" className="text-xl font-extrabold uppercase tracking-wide">
            Nova mensagem
          </p>
        </div>

        <div className="px-5 py-4">
          <p className="text-2xl font-bold leading-tight text-ink">{current.group}</p>
          <p className="mt-1 text-base font-semibold text-ink-2">
            {current.who}
            {current.phone && <span className="font-normal text-muted"> · {current.phone}</span>}
          </p>
          {current.text && (
            <p className="mt-3 line-clamp-5 rounded-xl bg-surface-2 px-4 py-3 text-base text-ink">{current.text}</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
          <button
            type="button"
            onClick={openGroup}
            autoFocus
            className="flex-1 rounded-xl bg-brand px-4 py-3 text-base font-bold text-brand-ink hover:opacity-90"
          >
            Abrir grupo
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-base font-medium text-ink-2 hover:text-ink"
          >
            Fechar
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
