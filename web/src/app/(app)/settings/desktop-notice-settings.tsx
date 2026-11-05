'use client';

import { MonitorUp, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { NoticeGuide, runNoticeTest } from '@/components/desktop-notice-guide';
import { Button, Card, CardHeader, Toggle } from '@/components/ui';
import {
  detectEnvironment,
  enableSystemNotices,
  setSystemNoticePref,
  systemNoticePref,
  systemNoticeState,
  type NoticeEnvironment,
  type SystemNoticeState,
} from '@/lib/system-notice';

/**
 * Avisos fora da tela do sistema: com a aba em segundo plano, a janela minimizada ou outro programa na frente,
 * o aviso aparece também como notificação do computador. A permissão é de cada navegador, por isso fica aqui
 * para cada pessoa ativar no seu.
 */
export function DesktopNoticeSettings() {
  const [state, setState] = useState<SystemNoticeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState<NoticeEnvironment | null>(null);
  // orientações para liberar no navegador e no sistema: abrem sozinhas ao ativar (ou quando está bloqueado)
  const [guide, setGuide] = useState(false);
  // preferência deste navegador: ligado/desligado (a permissão do navegador fica como está)
  const [wanted, setWanted] = useState(true);

  useEffect(() => {
    const read = () => {
      setState(systemNoticeState());
      setWanted(systemNoticePref());
      setEnv(detectEnvironment());
    };
    read();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const next = await enableSystemNotices();
      setState(next);
      if (next === 'granted') {
        toast.success('Avisos fora da tela ativados neste navegador', { description: 'Confira também as notificações do computador, nas orientações abaixo.' });
        setGuide(true);
      } else if (next === 'denied') {
        toast.error('O navegador bloqueou as notificações. Veja como liberar abaixo.');
        setGuide(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (next: boolean) => {
    setSystemNoticePref(next);
    setWanted(next);
    if (!next) {
      toast.success('Avisos fora da tela desativados neste navegador', { description: 'Os avisos continuam aparecendo dentro da tela do sistema. É só ativar de novo quando quiser.' });
      return;
    }
    // ativar sem a permissão do navegador: pede agora (e abre as orientações se ele bloquear)
    if (state !== 'granted') await enable();
    else toast.success('Avisos fora da tela ativados neste navegador');
  };

  const test = runNoticeTest;

  const status =
    state === null
      ? null
      : state === 'unsupported'
        ? 'Este navegador não mostra notificações do computador.'
        : state === 'granted'
          ? wanted
            ? 'Ativado neste navegador.'
            : 'Desativado neste navegador.'
          : state === 'denied'
            ? 'Bloqueado pelo navegador: libere nas orientações abaixo e ative.'
            : 'Ainda não ativado neste navegador.';
  const on = state === 'granted' && wanted;

  return (
    <Card>
      <CardHeader
        title={
          <>
            <MonitorUp className="h-4 w-4" aria-hidden /> Avisos fora da tela do sistema
          </>
        }
        description="Quando o sistema está em segundo plano (outra aba, janela minimizada ou outro programa na frente), o aviso aparece também como notificação do computador. Clicar nela traz o sistema para a frente e abre a tela do aviso. Fica ligado por padrão: no próximo acesso, um pop-up ajuda cada pessoa a ativar e conferir."
      />
      <div className="space-y-3 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        {state !== null && (
          <Toggle
            checked={on}
            onChange={(next) => void toggle(next)}
            disabled={state === 'unsupported' || busy}
            label={<span className="text-sm font-medium">{on ? 'Avisos fora da tela ativados' : 'Avisos fora da tela desativados'}</span>}
          />
        )}
        {status && <p className="text-xs text-ink-2">{status}</p>}
        <div className="flex flex-wrap gap-2">
          {on && (
            <Button variant="secondary" onClick={test}>
              <Send className="h-4 w-4" /> Testar (em 5 segundos)
            </Button>
          )}
          {state === 'granted' && (
            <Button variant="ghost" onClick={() => setGuide((g) => !g)}>
              {guide ? 'Ocultar orientações' : 'Orientações do navegador e do computador'}
            </Button>
          )}
        </div>
        {env && (guide || state === 'denied') && <NoticeGuide env={env} denied={state === 'denied'} />}
        <p className="text-xs text-muted">
          Vale para este navegador e funciona com o sistema aberto em alguma aba. A configuração de cada pessoa é independente. Para receber com o navegador fechado, ative as notificações push em <strong>Meu perfil</strong>. Se o computador estiver no modo
          &ldquo;Não incomodar&rdquo; ou &ldquo;Assistente de foco&rdquo;, ele pode esconder as notificações.
        </p>
      </div>
    </Card>
  );
}
