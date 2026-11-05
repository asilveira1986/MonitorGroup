/**
 * Notificações do computador para os avisos em tela: quando a página do sistema não está à vista (outra aba,
 * janela minimizada ou outro programa na frente), o aviso aparece também como notificação do sistema operacional.
 * Precisa da permissão do navegador; o clique traz o painel para a frente e abre a tela do aviso.
 */

export type SystemNoticeState = 'unsupported' | 'denied' | 'default' | 'granted';

export type SystemNotice = {
  title: string;
  body: string;
  /** o mesmo assunto substitui a notificação anterior em vez de empilhar */
  tag: string;
  /** tela aberta ao clicar (endereço do painel) */
  url: string | null;
  /** fica na tela até alguém fechar */
  keep?: boolean;
};

export function systemNoticeState(): SystemNoticeState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/** A página do sistema está fora da vista de quem usa? (outra aba, minimizada ou outro programa na frente) */
export function pageOutOfSight(): boolean {
  return document.visibilityState !== 'visible' || !document.hasFocus();
}

/** Pede a permissão (no toque do botão) e deixa o service worker pronto para mostrar e tratar o clique. */
export async function enableSystemNotices(): Promise<SystemNoticeState> {
  if (systemNoticeState() === 'unsupported') return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission === 'granted' && 'serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    } catch {
      /* sem service worker: a notificação simples ainda funciona */
    }
  }
  return permission;
}

/**
 * Mostra a notificação. Com o aparelho já inscrito nas notificações push, os avisos que o servidor também
 * envia por push (skipIfPushed) não são repetidos aqui.
 */
export async function showSystemNotice(
  notice: SystemNotice,
  opts: { skipIfPushed?: boolean; onClick?: () => void } = {},
): Promise<boolean> {
  try {
    if (systemNoticeState() !== 'granted') return false;
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/') : undefined;
    if (opts.skipIfPushed && reg && (await reg.pushManager.getSubscription())) return false;
    const body = notice.body.slice(0, 240);
    if (reg) {
      // o clique é tratado pelo service worker (sw.js): traz o painel para a frente e abre a tela do aviso
      // renotify (avisa de novo no mesmo assunto) existe nos navegadores, mas não nos tipos do TypeScript
      const options: NotificationOptions & { renotify?: boolean } = {
        body,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: notice.tag,
        renotify: true,
        requireInteraction: Boolean(notice.keep),
        data: { url: notice.url || '/dashboard' },
      };
      await reg.showNotification(notice.title, options);
      return true;
    }
    const n = new Notification(notice.title, { body, icon: '/icon-192.png', tag: notice.tag, requireInteraction: Boolean(notice.keep) });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
    return true;
  } catch {
    return false;
  }
}
