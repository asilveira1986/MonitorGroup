'use client';

import { AlertOctagon, AlertTriangle, Bell, BellOff, Clock, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ALERT_TYPE_LABEL, cn, formatDuration, formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { Alert, Message } from '@/lib/types';
import { playAlertSound, type AlertSound } from '@/lib/sounds';
import { useRealtime } from '@/lib/use-realtime';
import { renderTemplate, sampleValues, speak, spokenDuration, templateFor, type VoiceOptions } from '@/lib/voice';

/** Configuração dos alertas em tela (Configurações › Geral), igual para todos. */
export type AlertConfig = {
  /** mostra o aviso de nova mensagem */
  enabled: boolean;
  /** mostra também os alertas do sistema e o aviso de SLA excedido */
  alerts: boolean;
  /** 0 = fica na tela até alguém fechar; senão, fecha sozinho depois destes segundos */
  autoClose: number;
  /** toca o bipe */
  sound: boolean;
  /** fala o aviso em voz alta (português) — Configurações › Regras de alerta */
  voice?: boolean;
  /** voz: fala as mensagens novas */
  voiceMessages?: boolean;
  /** voz: fala o SLA excedido */
  voiceSla?: boolean;
  /** frases, voz, velocidade e tom */
  voiceOptions?: VoiceOptions;
};

const STORAGE_KEY = 'notify-messages';
/** Evento do botão "Testar alerta" das configurações. */
export const TEST_EVENT = 'msg-alert-test';
const SLA_POLL_MS = 30_000;

/** Alertas silenciados neste navegador pelo sino do topo? (padrão: não) */
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

type Tone = 'brand' | 'critical' | 'warning' | 'info';

/** Um aviso em tela: nova mensagem, SLA excedido ou alerta do sistema. Todos no mesmo formato. */
type ScreenItem = {
  /** chave de substituição: o mesmo grupo/assunto atualiza o aviso em vez de empilhar */
  key: string;
  tone: Tone;
  heading: string;
  icon: typeof Bell;
  group: string;
  /** linha abaixo do grupo (quem enviou, ou o título do alerta) */
  who?: string | null;
  phone?: string | null;
  text: string | null;
  /** destaque abaixo da mensagem (ex.: "Esperando há 45 min · SLA 30 min") */
  note?: string | null;
  href: string | null;
  action: string;
  at: number;
  /** frase do aviso por voz */
  speech?: string;
};

/** som de cada tipo de aviso quando não há fala */
const TONE_SOUND: Record<Tone, AlertSound> = { brand: 'message', info: 'info', warning: 'warning', critical: 'critical' };

const TONE: Record<Tone, { header: string; border: string; button: string; glow: string }> = {
  brand: { header: 'bg-brand text-brand-ink', border: 'border-brand-line', button: 'bg-brand text-brand-ink', glow: 'var(--brand)' },
  critical: { header: 'bg-critical text-white', border: 'border-critical', button: 'bg-critical text-white', glow: 'var(--critical)' },
  warning: { header: 'bg-warning text-black', border: 'border-warning', button: 'bg-warning text-black', glow: 'var(--warning)' },
  info: { header: 'bg-series-1 text-white', border: 'border-series-1', button: 'bg-series-1 text-white', glow: 'var(--series-1)' },
};

/** tipo da mensagem dito por extenso no aviso por voz */
const VOICE_TYPE: Record<string, string> = {
  text: 'texto',
  image: 'imagem',
  video: 'vídeo',
  audio: 'áudio',
  document: 'documento',
  sticker: 'figurinha',
  contact: 'contato',
  location: 'localização',
};

const messageText = (type: string, body: string | null) =>
  type === 'text' ? body : `${TYPE_LABEL[type] ?? type}${body ? ` ${body}` : ''}`;

/**
 * Quem recebe avisos só dos grupos em que é responsável (Configurações › Equipe): os grupos dele
 * e os grupos sem responsável. null = todos os grupos. Lido no máximo a cada 30 s.
 */
let scopeCache: { at: number; groups: Set<string> | null } | null = null;
async function inMyAlertScope(groupId: string | null | undefined): Promise<boolean> {
  if (!groupId) return true; // alerta sem grupo (ex.: WhatsApp desconectado) chega para todos
  if (!scopeCache || Date.now() - scopeCache.at > 30_000) {
    const { data, error } = await createClient().rpc('my_alert_groups');
    scopeCache = { at: Date.now(), groups: error || !Array.isArray(data) ? null : new Set(data as string[]) };
  }
  return !scopeCache.groups || scopeCache.groups.has(groupId);
}

/**
 * Avisos grandes no centro da tela, todos no mesmo formato:
 *  - NOVA MENSAGEM: cliente escreveu (grupo, quem enviou e a mensagem);
 *  - SLA EXCEDIDO: a mensagem do cliente passou do tempo de resposta do grupo;
 *  - alertas do sistema (cliente sem resposta, palavra-chave, desconexão...).
 * Toca um bipe e faz o título da aba piscar. Conforme Configurações › Geral, fica na tela até
 * alguém fechar ou fecha sozinho depois de um tempo. Um aviso por vez; o mesmo grupo/assunto
 * atualiza o aviso anterior em vez de empilhar.
 */
export function MessageNotifier({ config }: { config: AlertConfig }) {
  const router = useRouter();
  const [items, setItems] = useState<ScreenItem[]>([]);
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  });

  const push = (item: ScreenItem) => {
    if (mutedHere()) return;
    setItems((prev) => [item, ...prev.filter((i) => i.key !== item.key)]);
    // com a voz falando: bipe curto e a fala; sem voz: o som do tipo do aviso
    // (mensagem recebida, informativo, atenção ou crítico)
    const speaking = configRef.current.voice !== false && Boolean(item.speech);
    if (configRef.current.sound) playAlertSound(speaking ? 'voice' : TONE_SOUND[item.tone]);
    if (speaking) speak(item.speech!, configRef.current.voiceOptions, configRef.current.sound ? 450 : 0);
  };
  const pushRef = useRef(push);
  useEffect(() => {
    pushRef.current = push;
  });

  // "Testar alerta" nas configurações
  useEffect(() => {
    const test = () =>
      pushRef.current({
        key: 'teste',
        tone: 'brand',
        heading: 'Nova mensagem',
        icon: Bell,
        group: 'Grupo de exemplo',
        who: 'Cliente',
        phone: '+55 (11) 99999-9999',
        text: 'Esta é uma mensagem de teste do alerta.',
        href: null,
        action: 'Abrir grupo',
        at: Date.now(),
        speech: renderTemplate(templateFor(configRef.current.voiceOptions, 'message'), sampleValues('message')),
      });
    window.addEventListener(TEST_EVENT, test);
    return () => window.removeEventListener(TEST_EVENT, test);
  }, []);

  useRealtime('screen-alerts', (channel) =>
    channel
      // nova mensagem de cliente
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const m = payload.new as Message;
        if (m.from_team || m.ignored_as_last || !configRef.current.enabled) return;
        // a importação do histórico não gera aviso
        if (Date.now() - new Date(m.sent_at).getTime() > 10 * 60_000) return;
        void Promise.all([
          createClient().from('groups').select('name, monitored').eq('id', m.group_id).maybeSingle(),
          inMyAlertScope(m.group_id),
        ]).then(([{ data: g }, mine]) => {
            if (!g || !g.monitored || !mine) return;
            const v = configRef.current;
            pushRef.current({
              speech:
                v.voiceMessages !== false
                  ? renderTemplate(templateFor(v.voiceOptions, 'message'), {
                      grupo: g.name,
                      remetente: m.sender_name || 'um cliente',
                      mensagem: m.message_type === 'text' ? m.body : null,
                      tipo_mensagem: VOICE_TYPE[m.message_type] ?? m.message_type,
                    })
                  : undefined,
              key: `msg-${m.group_id}`,
              tone: 'brand',
              heading: 'Nova mensagem',
              icon: Bell,
              group: g.name,
              who: m.sender_name || formatPhone(m.sender_phone) || 'Cliente',
              phone: m.sender_name && m.sender_phone ? formatPhone(m.sender_phone) : null,
              text: messageText(m.message_type, m.body),
              href: `/groups/${m.group_id}`,
              action: 'Abrir grupo',
              at: Date.now(),
            });
          });
      })
      // alerta criado pelo sistema
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, (payload) => {
        const a = payload.new as Alert;
        void inMyAlertScope(a.group_id).then((mine) => {
          if (!mine) return;
          if (!configRef.current.alerts) {
            // alertas em tela desligados: aviso pequeno no canto, como antes
            const show = a.severity === 'critical' ? toast.error : a.severity === 'warning' ? toast.warning : toast.info;
            show(a.title, {
              description: a.description?.slice(0, 140),
              action: { label: 'Ver', onClick: () => router.push('/alerts') },
              duration: 10_000,
            });
            return;
          }
          const tone: Tone = a.severity === 'critical' ? 'critical' : a.severity === 'warning' ? 'warning' : 'info';
          // a regra do alerta escolhe se ele é falado (Editar regra › Aviso por voz)
          const show = (group: string | null, voice: boolean) =>
            pushRef.current({
              speech: !voice
                ? undefined
                : renderTemplate(templateFor(configRef.current.voiceOptions, 'alert'), {
                    tipo: ALERT_TYPE_LABEL[a.type] ?? 'alerta',
                    gravidade: a.severity === 'critical' ? 'crítico' : a.severity === 'warning' ? 'atenção' : 'informativo',
                    grupo: group,
                    titulo: a.title,
                    descricao: a.description,
                  }),
              // "cliente sem resposta" e "SLA excedido" do mesmo grupo viram um aviso só
              key: a.type === 'no_response' && a.group_id ? `late-${a.group_id}` : `alert-${a.id}`,
              tone,
              heading: ALERT_TYPE_LABEL[a.type] ?? 'Alerta',
              icon: a.severity === 'critical' ? AlertOctagon : a.severity === 'warning' ? AlertTriangle : Info,
              group: group ?? a.title,
              who: group ? a.title : null,
              text: a.description,
              href: a.group_id ? `/groups/${a.group_id}` : '/alerts',
              action: a.group_id ? 'Abrir grupo' : 'Ver alertas',
              at: Date.now(),
            });
          const supabase = createClient();
          void Promise.all([
            a.group_id ? supabase.from('groups').select('name').eq('id', a.group_id).maybeSingle() : Promise.resolve({ data: null }),
            a.rule_id ? supabase.from('alert_rules').select('voice').eq('id', a.rule_id).maybeSingle() : Promise.resolve({ data: null }),
          ]).then(([{ data: g }, { data: r }]) =>
            show((g as { name: string } | null)?.name ?? null, (r as { voice?: boolean } | null)?.voice !== false),
          );
        });
      }),
  );

  // SLA excedido: confere a cada 30 s quais grupos passaram do tempo de resposta.
  // Avisa na virada (a mesma pendência só uma vez); as que já estavam vencidas ao abrir a tela não abrem aviso.
  useEffect(() => {
    if (!config.alerts) return;
    const seen = new Set<string>();
    let first = true;
    let stop = false;
    const check = async () => {
      const { data } = await createClient().rpc('sla_breaches');
      if (stop || !Array.isArray(data)) return;
      for (const b of data as {
        group_id: string;
        group: string;
        pending_since: string;
        pending_count: number;
        waiting_seconds: number;
        sla_seconds: number;
        who: string;
        phone: string | null;
        body: string | null;
        type: string | null;
      }[]) {
        const key = `${b.group_id}|${b.pending_since}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (first) continue;
        if (!(await inMyAlertScope(b.group_id))) continue;
        pushRef.current({
          speech:
            configRef.current.voiceSla !== false
              ? renderTemplate(templateFor(configRef.current.voiceOptions, 'sla'), {
                  grupo: b.group,
                  espera: spokenDuration(b.waiting_seconds),
                  sla: spokenDuration(b.sla_seconds),
                  pendentes: b.pending_count,
                  remetente: b.who,
                  mensagem: b.type === 'text' || !b.type ? b.body : null,
                })
              : undefined,
          key: `late-${b.group_id}`,
          tone: 'critical',
          heading: 'SLA excedido',
          icon: Clock,
          group: b.group,
          who: b.who,
          phone: b.phone ? formatPhone(b.phone) : null,
          text: messageText(b.type ?? 'text', b.body),
          note: `${b.pending_count} sem resposta · esperando há ${formatDuration(b.waiting_seconds)} · SLA ${formatDuration(b.sla_seconds)}`,
          href: `/groups/${b.group_id}`,
          action: 'Abrir grupo',
          at: Date.now(),
        });
      }
      first = false;
    };
    void check();
    const id = setInterval(() => void check(), SLA_POLL_MS);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [config.alerts]);

  const open = items.length > 0;

  // título da aba piscando enquanto há aviso aberto; Esc fecha o aviso atual
  useEffect(() => {
    if (!open) return;
    const original = document.title;
    let on = false;
    const id = setInterval(() => {
      on = !on;
      document.title = on ? `🔔 ${items[0]?.heading ?? 'Aviso'} (${items.length})` : original;
    }, 1000);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setItems((prev) => prev.slice(1));
    document.addEventListener('keydown', onKey);
    return () => {
      clearInterval(id);
      document.title = original;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, items]);

  if (!open) return null;
  // um aviso por vez: o mais recente; ao fechar, aparece o próximo
  const current = items[0];
  const t = TONE[current.tone];
  const dismiss = () => setItems((prev) => prev.slice(1));
  const go = () => {
    dismiss();
    if (current.href) router.push(current.href);
  };
  const Icon = current.icon;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
      onClick={dismiss}
      role="presentation"
    >
      <div
        key={current.key + current.at}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="msgalert-title"
        onClick={(e) => e.stopPropagation()}
        style={{ ['--alert-glow' as string]: t.glow }}
        className={cn('msgalert-box w-full max-w-lg overflow-hidden rounded-3xl border-4 bg-surface', t.border)}
      >
        <div className={cn('relative flex items-center gap-3 px-5 py-3.5', t.header)}>
          <span className="msgalert-bell flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <p id="msgalert-title" className="text-xl font-extrabold uppercase tracking-wide">
            {current.heading}
          </p>
          {config.autoClose > 0 && (
            <AutoClose key={current.key + current.at} seconds={config.autoClose} onDone={dismiss} />
          )}
        </div>

        <div className="px-5 py-4">
          <p className="text-2xl font-bold leading-tight text-ink">{current.group}</p>
          {current.who && (
            <p className="mt-1 text-base font-semibold text-ink-2">
              {current.who}
              {current.phone && <span className="font-normal text-muted"> · {current.phone}</span>}
            </p>
          )}
          {current.text && (
            <p className="mt-3 line-clamp-5 whitespace-pre-line rounded-xl bg-surface-2 px-4 py-3 text-base text-ink">
              {current.text}
            </p>
          )}
          {current.note && <p className="mt-3 text-sm font-semibold text-critical-ink">{current.note}</p>}
        </div>

        <div className="flex gap-2 border-t border-line bg-surface-2/60 px-5 py-3">
          <button
            type="button"
            onClick={go}
            autoFocus
            className={cn('flex-1 rounded-xl px-4 py-3 text-base font-bold hover:opacity-90', t.button)}
          >
            {current.action}
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
