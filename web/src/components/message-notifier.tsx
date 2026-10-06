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

/**
 * Popup na tela a cada mensagem nova de cliente: nome do grupo, quem enviou (nome e número),
 * um trecho da mensagem e quantas mensagens do grupo aguardam resposta.
 * Mensagens seguidas do mesmo grupo atualizam o mesmo aviso em vez de empilhar vários.
 */
export function MessageNotifier() {
  const router = useRouter();

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
          const who = m.sender_name || formatPhone(m.sender_phone) || 'Cliente';
          const phone = m.sender_name && m.sender_phone ? ` · ${formatPhone(m.sender_phone)}` : '';
          const text = m.message_type === 'text' ? m.body : `${TYPE_LABEL[m.message_type] ?? m.message_type}${m.body ? ` ${m.body}` : ''}`;
          const n = g.pending_count ?? 0;
          toast.info(`Nova mensagem · ${g.name}`, {
            id: `msg-${m.group_id}`,
            description: (
              <span className="block space-y-0.5">
                <span className="block font-medium">
                  {who}
                  {phone}
                </span>
                {text && <span className="line-clamp-2 block opacity-90">{text}</span>}
                <span className="block text-xs opacity-80">
                  {n === 0
                    ? 'Nenhuma mensagem aguardando resposta'
                    : `${n} ${n === 1 ? 'mensagem aguardando' : 'mensagens aguardando'} resposta neste grupo`}
                </span>
              </span>
            ),
            action: { label: 'Abrir', onClick: () => router.push(`/groups/${m.group_id}`) },
            duration: 12_000,
          });
        });
    }),
  );

  return null;
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
