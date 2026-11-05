'use client';

import { Copy, ExternalLink, MonitorUp, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Toggle } from '@/components/ui';
import {
  browserSettingsUrl,
  detectEnvironment,
  enableSystemNotices,
  osSettingsLink,
  setSystemNoticePref,
  showSystemNotice,
  systemNoticePref,
  systemNoticeState,
  type NoticeEnvironment,
  type SystemNoticeState,
} from '@/lib/system-notice';

const BROWSER_NAME: Record<NoticeEnvironment['browser'], string> = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  opera: 'Opera',
  brave: 'Brave',
  outro: 'seu navegador',
};
const OS_NAME: Record<NoticeEnvironment['os'], string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iPhone/iPad',
  outro: 'o computador',
};

/** Abre o endereço especial das configurações do sistema (o navegador pede confirmação). */
function openSystemSettings(link: string) {
  window.location.assign(link);
}

/** Passo a passo para conferir a permissão no navegador e as notificações do sistema operacional. */
function Guide({ env, denied }: { env: NoticeEnvironment; denied: boolean }) {
  const browserUrl = browserSettingsUrl(env.browser, window.location.origin);
  const osLink = osSettingsLink(env.os);
  const copy = async () => {
    if (!browserUrl) return;
    try {
      await navigator.clipboard.writeText(browserUrl);
      toast.success('Endereço copiado', { description: 'Abra uma nova aba, cole na barra de endereço e tecle Enter.' });
    } catch {
      toast.error('Não foi possível copiar. Selecione o endereço e copie manualmente.');
    }
  };
  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface-2/50 p-3 text-sm sm:p-4">
      <div className="space-y-2">
        <p className="font-semibold text-ink">1. No navegador ({BROWSER_NAME[env.browser]})</p>
        <p className="text-ink-2">
          {denied ? 'As notificações deste site estão bloqueadas. ' : ''}A permissão de notificações deste site precisa estar em <strong>Permitir</strong>.
        </p>
        {env.os === 'ios' ? (
          <p className="text-ink-2">No iPhone e no iPad, as notificações do navegador só funcionam com o sistema adicionado à Tela de Início (veja em Meu perfil).</p>
        ) : env.os === 'android' ? (
          <p className="text-ink-2">
            Toque no cadeado ao lado do endereço do sistema, depois em <strong>Permissões</strong> e deixe <strong>Notificações</strong> em Permitir.
          </p>
        ) : browserUrl ? (
          <>
            <p className="text-ink-2">
              O navegador não deixa uma página abrir as próprias configurações. Copie o endereço, abra uma <strong>nova aba</strong>, cole na barra de endereço e tecle Enter:
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-2 py-1.5 text-xs text-ink">{browserUrl}</code>
              <Button variant="secondary" size="sm" onClick={() => void copy()}>
                <Copy className="h-3.5 w-3.5" /> Copiar endereço
              </Button>
            </div>
          </>
        ) : env.browser === 'safari' ? (
          <p className="text-ink-2">
            No menu do Safari, abra <strong>Ajustes › Sites › Notificações</strong> e deixe este site em Permitir.
          </p>
        ) : (
          <p className="text-ink-2">
            Clique no cadeado ao lado do endereço do sistema, abra as configurações do site e deixe <strong>Notificações</strong> em Permitir.
          </p>
        )}
      </div>

      {env.os !== 'ios' && env.os !== 'android' && (
        <div className="space-y-2">
          <p className="font-semibold text-ink">2. No {OS_NAME[env.os]}</p>
          {env.os === 'windows' && (
            <p className="text-ink-2">
              Deixe as notificações ligadas, confira se o seu navegador aparece na lista com as notificações <strong>ligadas</strong> e desative o <strong>Assistente de foco</strong> (ou &ldquo;Não incomodar&rdquo;).
            </p>
          )}
          {env.os === 'mac' && (
            <p className="text-ink-2">
              Procure o seu navegador na lista, permita as notificações e confira se o <strong>Foco</strong> (&ldquo;Não incomodar&rdquo;) não está ligado.
            </p>
          )}
          {(env.os === 'linux' || env.os === 'outro') && (
            <p className="text-ink-2">
              Nas configurações do seu ambiente (por exemplo, <strong>Configurações › Notificações</strong>), deixe as notificações ligadas para o navegador e o modo &ldquo;Não perturbe&rdquo; desligado.
            </p>
          )}
          {osLink && (
            <>
              <Button variant="secondary" size="sm" onClick={() => openSystemSettings(osLink)}>
                <ExternalLink className="h-3.5 w-3.5" /> Abrir as notificações do {OS_NAME[env.os]}
              </Button>
              <p className="text-xs text-muted">O navegador pode perguntar se permite abrir as Configurações: escolha Abrir. Se nada abrir, procure por &ldquo;Notificações&rdquo; nas configurações do sistema.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

  // dá tempo de trocar de aba ou minimizar para ver o aviso aparecer fora da página
  const test = () => {
    toast.message('Troque de aba ou minimize o navegador: o aviso aparece em 5 segundos.');
    window.setTimeout(() => {
      void showSystemNotice({
        title: 'Teste · Aviso fora da tela',
        body: 'Se você está vendo esta notificação, os avisos chegam mesmo com o sistema em segundo plano.',
        tag: 'screen-test',
        url: '/settings/avisos',
      }).then((res) => {
        if (!res.ok) return void toast.error('Não foi possível mostrar a notificação', { description: res.reason });
        // o navegador aceitou: se não apareceu na tela, quem esconde é o computador
        toast.success('O navegador enviou a notificação', {
          description:
            'Se ela não apareceu, o computador está escondendo: confira as notificações do navegador nas configurações do Windows ou do macOS e o modo "Não incomodar".',
          duration: 12_000,
        });
      });
    }, 5000);
  };

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
        description="Quando o sistema está em segundo plano (outra aba, janela minimizada ou outro programa na frente), o aviso aparece também como notificação do computador. Clicar nela traz o sistema para a frente e abre a tela do aviso."
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
        {env && (guide || state === 'denied') && <Guide env={env} denied={state === 'denied'} />}
        <p className="text-xs text-muted">
          Vale para este navegador e funciona com o sistema aberto em alguma aba. A configuração de cada pessoa é independente. Para receber com o navegador fechado, ative as notificações push em <strong>Meu perfil</strong>. Se o computador estiver no modo
          &ldquo;Não incomodar&rdquo; ou &ldquo;Assistente de foco&rdquo;, ele pode esconder as notificações.
        </p>
      </div>
    </Card>
  );
}
