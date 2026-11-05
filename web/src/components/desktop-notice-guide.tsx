'use client';

import { Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { browserSettingsUrl, osSettingsLink, showSystemNotice, type NoticeEnvironment } from '@/lib/system-notice';

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
export function NoticeGuide({ env, denied }: { env: NoticeEnvironment; denied: boolean }) {
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


/** Teste dos avisos fora da tela: dá tempo de trocar de aba ou minimizar para ver o aviso aparecer fora da página. */
export function runNoticeTest() {
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
}
