'use client';

import { Bell, BellOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { Message } from '@/lib/types';
import { useRealtime } from '@/lib/use-realtime';

/** Configuração do alerta (Configurações › Geral), igual para todos. */
export type AlertConfig = {
  /** mostra o alerta */
  enabled: boolean;
  /** 0 = fica na tela até alguém fechar; senão, fecha sozinho depois destes segundos */
  autoClose: number;
  /** toca o bipe */
  sound: boolean;
};

const STORAGE_KEY = 'notify-messages';
/** Evento do botão "Testar aviso" das configurações. */
export const TEST_EVENT = 'msg-alert-test';

/** Alerta silenciado neste navegador pelo sino do topo? (padrão: não) */
function mutedHere() {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'off';
  } catch {
    return false;
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
 * Conforme Configurações › Geral, fica na tela até alguém fechar ou fecha sozinho depois de
 * um tempo; uma mensagem nova do mesmo grupo substitui a anterior, e outros grupos aparecem em
 * seguida, um por vez.
 */
export function MessageNotifier({ config }: { config: AlertConfig }) {
  const router = useRouter();
  const [items, setItems] = useState<AlertItem[]>([]);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const push = (item: AlertItem) => {
    // o mais recente no topo; mensagem nova do mesmo grupo substitui a anterior
    setItems((prev) => [item, ...prev.filter((i) => i.groupId !== item.groupId)]);
    if (configRef.current.sound) beep();
  };

  // "Testar aviso" na configuração
  useEffect(() => {
    const test = () =>
      push({
        groupId: 'teste',
        group: 'Grupo de exemplo',
        who: 'Cliente',
        phone: '+55 (11) 99999-9999',
        text: 'Esta é uma mensagem de teste do alerta.',
        at: Date.now(),
      });
    window.addEventListener(TEST_EVENT, test);
    return () => window.removeEventListener(TEST_EVENT, test);
  });

  useRealtime('message-notifier', (channel) =>
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
      const m = payload.new as Message;
      // só mensagens de clientes, recentes (a importação do histórico não gera aviso)
      if (m.from_team || !configRef.current.enabled || mutedHere()) return;
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
          push({
            groupId: m.group_id,
            group: g.name,
            who: m.sender_name || formatPhone(m.sender_phone) || 'Cliente',
            phone: m.sender_name && m.sender_phone ? formatPhone(m.sender_phone) : null,
            text,
            at: Date.now(),
          });
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
    if (current.groupId !== 'teste') router.push(`/groups/${current.groupId}`);
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
        className="msgalert-box group/alert w-full max-w-lg overflow-hidden rounded-3xl border-4 border-brand bg-surface"
      >
        <div className="relative flex items-center gap-3 bg-brand px-5 py-3.5 text-brand-ink">
          <span className="msgalert-bell flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Bell className="h-5 w-5" aria-hidden />
          </span>
          <p id="msgalert-title" className="text-xl font-extrabold uppercase tracking-wide">
            Nova mensagem
          </p>
          {config.autoClose > 0 && (
            <AutoClose key={current.groupId + current.at} seconds={config.autoClose} onDone={dismiss} />
          )}
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

/**
 * Contagem regressiva do fechamento automático: barra que esvazia e o tempo restante.
 * Com o mouse sobre o alerta, a contagem pausa.
 */
function AutoClose({ seconds, onDone }: { seconds: number; onDone: () => void }) {
  const [left, setLeft] = useState(seconds * 1000);
  const paused = useRef(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    const id = setInterval(() => {
      if (paused.current) return;
      setLeft((l) => {
        const next = l - 100;
        if (next <= 0) {
          clearInterval(id);
          setTimeout(() => done.current(), 0);
        }
        return Math.max(0, next);
      });
    }, 100);
    // pausa com o mouse sobre o alerta
    const box = document.querySelector('[role=alertdialog]');
    const pause = () => (paused.current = true);
    const resume = () => (paused.current = false);
    box?.addEventListener('mouseenter', pause);
    box?.addEventListener('mouseleave', resume);
    return () => {
      clearInterval(id);
      box?.removeEventListener('mouseenter', pause);
      box?.removeEventListener('mouseleave', resume);
    };
  }, []);
  return (
    <>
      <span
        className="ml-auto shrink-0 rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold tabular"
        title="Fecha sozinho (a contagem pausa com o mouse sobre o alerta)"
      >
        fecha em {Math.ceil(left / 1000)}s
      </span>
      {/* barra que esvazia, na base do cabeçalho */}
      <span className="absolute inset-x-0 bottom-0 h-1.5 bg-black/20" aria-hidden>
        <span
          className="block h-full bg-white/85 transition-[width] duration-100 ease-linear"
          style={{ width: `${(left / (seconds * 1000)) * 100}%` }}
        />
      </span>
    </>
  );
}

/** Botão do topo para silenciar ou religar o alerta de nova mensagem neste navegador. */
export function NotifyToggle() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferência guardada no navegador
    setOn(!mutedHere());
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
