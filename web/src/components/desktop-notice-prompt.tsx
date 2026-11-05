'use client';

import { BellRing, CheckCircle2, MonitorUp, Send, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { NoticeGuide, runNoticeTest } from '@/components/desktop-notice-guide';
import { Button } from '@/components/ui';
import {
  detectEnvironment,
  enableSystemNotices,
  setSystemNoticePref,
  systemNoticePref,
  systemNoticeState,
  type NoticeEnvironment,
  type SystemNoticeState,
} from '@/lib/system-notice';

const DONE_KEY = 'screen-notice-setup-done';
const SNOOZE_KEY = 'screen-notice-setup-snooze';
/** "Agora não" ou fechar sem concluir: o pop-up volta só depois deste tempo */
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento local */
  }
};

/**
 * Pop-up no próximo acesso de cada pessoa para configurar os avisos fora da tela (notificação do computador).
 * Passo 1: explica e pede a permissão no clique de "Ativar agora" (um gesto da pessoa, como o navegador exige).
 * Passo 2: orientações do navegador e do sistema, com teste. Não aparece para quem já permitiu, quem desligou
 * os avisos fora da tela, quem concluiu ou quando o navegador não oferece notificações; "Agora não" adia
 * por 3 dias.
 */
export function DesktopNoticePrompt() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'ask' | 'guide'>('ask');
  const [state, setState] = useState<SystemNoticeState>('default');
  const [env, setEnv] = useState<NoticeEnvironment | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const current = systemNoticeState();
    if (current === 'unsupported' || current === 'granted' || !systemNoticePref()) return;
    if (read(DONE_KEY)) return;
    const snoozed = Number(read(SNOOZE_KEY) ?? 0);
    if (snoozed && Date.now() - snoozed < SNOOZE_MS) return;
    // um instante depois de abrir a tela, para não atravessar o carregamento
    const id = setTimeout(() => {
      setState(current);
      setEnv(detectEnvironment());
      setStep(current === 'denied' ? 'guide' : 'ask');
      setOpen(true);
    }, 2500);
    return () => clearTimeout(id);
  }, []);

  const later = () => {
    write(SNOOZE_KEY, String(Date.now()));
    setOpen(false);
  };
  const finish = () => {
    write(DONE_KEY, '1');
    setOpen(false);
  };
  const never = () => {
    setSystemNoticePref(false);
    write(DONE_KEY, '1');
    setOpen(false);
    toast.message('Avisos fora da tela desativados', { description: 'Para ligar de novo, vá em Configurações › Avisos.' });
  };
  // fechar: se já ativou, está concluído; senão, adia
  const close = () => (state === 'granted' ? finish() : later());

  const activate = async () => {
    setBusy(true);
    try {
      const next = await enableSystemNotices();
      setState(next);
      if (next === 'granted' || next === 'denied') setStep('guide');
      else toast.message('O pedido do navegador foi fechado', { description: 'Clique em Ativar agora para tentar de novo e escolha Permitir.' });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // close depende do estado atual; reata o atalho a cada mudança relevante
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, step, state]);

  if (!open || !env) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Avisos fora da tela do sistema">
      <div className="absolute inset-0 bg-black/50" onClick={close} />
      <div className="relative flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-surface text-ink shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <MonitorUp className="h-5 w-5 text-brand-text" aria-hidden />
            {step === 'ask'
              ? 'Receba os avisos mesmo fora da tela do sistema'
              : state === 'granted'
                ? 'Avisos ativados! Falta só conferir'
                : 'O navegador bloqueou as notificações'}
          </h2>
          <button type="button" onClick={close} className="rounded-lg p-1 text-ink-2 hover:bg-surface-2" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-4 py-4 text-sm sm:px-5">
          {step === 'ask' ? (
            <>
              <p className="text-ink-2">
                Quando o sistema estiver em outra aba, minimizado ou com outro programa na frente, o aviso de mensagem de cliente, SLA excedido e alertas aparece como <strong>notificação do computador</strong>. Clicar nela traz o sistema para a frente.
              </p>
              <ul className="space-y-1.5 text-ink-2">
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden /> Leva um minuto e é feito uma vez por navegador.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden /> O navegador vai perguntar: escolha <strong>Permitir</strong>.
                </li>
                <li className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-good" aria-hidden /> Você pode desligar quando quiser em Configurações › Avisos.
                </li>
              </ul>
            </>
          ) : (
            <>
              {state === 'granted' && (
                <p className="text-ink-2">
                  O navegador já permitiu. Confira os dois itens abaixo e faça o teste: se a notificação aparecer fora da tela, está tudo certo.
                </p>
              )}
              <NoticeGuide env={env} denied={state === 'denied'} />
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3 sm:px-5">
          {step === 'ask' ? (
            <>
              <button type="button" onClick={never} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                Não quero esses avisos
              </button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={later}>
                  Agora não
                </Button>
                <Button autoFocus onClick={() => void activate()} disabled={busy}>
                  <BellRing className="h-4 w-4" /> Ativar agora
                </Button>
              </div>
            </>
          ) : state === 'granted' ? (
            <>
              <Button variant="secondary" onClick={runNoticeTest}>
                <Send className="h-4 w-4" /> Testar (em 5 segundos)
              </Button>
              <Button autoFocus onClick={finish}>
                Concluir
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => {
                  later();
                  router.push('/settings/avisos');
                }}
              >
                Abrir Configurações › Avisos
              </Button>
              <Button autoFocus onClick={later}>
                Fechar
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
