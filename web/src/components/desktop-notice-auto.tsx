'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { enableSystemNotices, systemNoticePref, systemNoticeState } from '@/lib/system-notice';

const ASKED_KEY = 'screen-notice-asked';
const TOLD_KEY = 'screen-notice-denied-told';
/** se a pessoa fechou o pedido do navegador sem responder, pergunta de novo só depois deste tempo */
const ASK_AGAIN_MS = 3 * 24 * 60 * 60 * 1000;

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
 * Deixa os avisos fora da tela ligados para todos, sem precisar ir às configurações. O navegador só libera as
 * notificações com a permissão de quem usa, então o pedido do navegador é feito no primeiro clique ou tecla
 * depois de entrar (o navegador exige um gesto da pessoa). Se ela fechar o pedido sem responder, pergunta de
 * novo só depois de alguns dias; se bloquear, avisa uma vez e leva às orientações em Configurações › Avisos.
 * Quem desligou os avisos fora da tela nas configurações não é incomodado.
 */
export function DesktopNoticeAuto() {
  const router = useRouter();

  useEffect(() => {
    const state = systemNoticeState();
    if (state === 'unsupported' || state === 'granted' || !systemNoticePref()) return;

    const tellBlocked = () => {
      if (read(TOLD_KEY)) return;
      write(TOLD_KEY, '1');
      toast.message('Os avisos fora da tela estão bloqueados neste navegador', {
        description: 'Por isso você só vê os avisos com o sistema aberto na tela. Veja como liberar.',
        action: { label: 'Ver como liberar', onClick: () => router.push('/settings/avisos') },
        duration: 15_000,
      });
    };

    if (state === 'denied') {
      const id = setTimeout(tellBlocked, 4000);
      return () => clearTimeout(id);
    }

    // permissão ainda não pedida: aguarda o primeiro gesto (o navegador não deixa pedir sem ele)
    const asked = Number(read(ASKED_KEY) ?? 0);
    if (asked && Date.now() - asked < ASK_AGAIN_MS) return;
    const ask = () => {
      remove();
      write(ASKED_KEY, String(Date.now()));
      toast.message('Avisos fora da tela', { description: 'Permita as notificações quando o navegador perguntar, para ver os avisos mesmo com o sistema em segundo plano.' });
      void enableSystemNotices().then((next) => {
        if (next === 'denied') tellBlocked();
      });
    };
    const remove = () => {
      document.removeEventListener('pointerdown', ask, true);
      document.removeEventListener('keydown', ask, true);
    };
    document.addEventListener('pointerdown', ask, true);
    document.addEventListener('keydown', ask, true);
    return remove;
  }, [router]);

  return null;
}
