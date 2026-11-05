'use client';

import { BellRing, MonitorUp, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader } from '@/components/ui';
import { enableSystemNotices, showSystemNotice, systemNoticeState, type SystemNoticeState } from '@/lib/system-notice';

/**
 * Avisos fora da tela do sistema: com a aba em segundo plano, a janela minimizada ou outro programa na frente,
 * o aviso aparece também como notificação do computador. A permissão é de cada navegador, por isso fica aqui
 * para cada pessoa ativar no seu.
 */
export function DesktopNoticeSettings() {
  const [state, setState] = useState<SystemNoticeState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const read = () => setState(systemNoticeState());
    read();
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const next = await enableSystemNotices();
      setState(next);
      if (next === 'granted') toast.success('Avisos fora da tela ativados neste navegador');
      else if (next === 'denied') toast.error('O navegador bloqueou as notificações. Veja como liberar abaixo.');
    } finally {
      setBusy(false);
    }
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
      }).then((ok) => {
        if (!ok) toast.error('Não foi possível mostrar a notificação. Confira a permissão do navegador.');
      });
    }, 5000);
  };

  const status =
    state === null
      ? null
      : state === 'unsupported'
        ? 'Este navegador não mostra notificações do computador.'
        : state === 'granted'
          ? 'Ativado neste navegador.'
          : state === 'denied'
            ? 'Bloqueado neste navegador.'
            : 'Ainda não ativado neste navegador.';

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
        {status && <p className="text-sm font-medium text-ink">{status}</p>}
        <div className="flex flex-wrap gap-2">
          {(state === 'default' || state === 'denied') && (
            <Button onClick={() => void enable()} disabled={busy}>
              <BellRing className="h-4 w-4" /> Ativar avisos fora da tela
            </Button>
          )}
          {state === 'granted' && (
            <Button variant="secondary" onClick={test}>
              <Send className="h-4 w-4" /> Testar (em 5 segundos)
            </Button>
          )}
        </div>
        {state === 'denied' && (
          <p className="text-xs text-ink-2">
            Para liberar, clique no cadeado ao lado do endereço do sistema, abra <strong>Notificações</strong> e escolha <strong>Permitir</strong>; depois recarregue a página.
          </p>
        )}
        <p className="text-xs text-muted">
          Vale para este navegador e funciona com o sistema aberto em alguma aba. A configuração de cada pessoa é independente. Para receber com o navegador fechado, ative as notificações push em <strong>Meu perfil</strong>. Se o computador estiver no modo
          &ldquo;Não incomodar&rdquo; ou &ldquo;Assistente de foco&rdquo;, ele pode esconder as notificações.
        </p>
      </div>
    </Card>
  );
}
