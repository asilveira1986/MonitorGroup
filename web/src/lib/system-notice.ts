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

export type SystemNoticeResult = { ok: true; via: 'service-worker' | 'navegador' } | { ok: false; reason: string };

/** Registro do service worker já ativo (registra se preciso e espera a ativação por alguns segundos). */
async function activeRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (!('serviceWorker' in navigator)) return undefined;
  try {
    let reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    if (reg.active) return reg;
    const ready = await Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000))]);
    return ready ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Mostra a notificação: pelo service worker (o clique traz o painel para a frente) e, se ele não estiver
 * pronto ou falhar, pela notificação simples do navegador. Com o aparelho já inscrito nas notificações
 * push, os avisos que o servidor também envia por push (skipIfPushed) não são repetidos aqui.
 */
export async function showSystemNotice(
  notice: SystemNotice,
  opts: { skipIfPushed?: boolean; onClick?: () => void } = {},
): Promise<SystemNoticeResult> {
  const state = systemNoticeState();
  if (state === 'unsupported') return { ok: false, reason: 'Este navegador não mostra notificações do computador.' };
  if (state !== 'granted') return { ok: false, reason: 'O navegador ainda não permitiu as notificações. Clique em "Ativar avisos fora da tela".' };
  const body = notice.body.slice(0, 240);
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
  let swError = '';
  const reg = await activeRegistration();
  if (reg) {
    try {
      if (opts.skipIfPushed && (await reg.pushManager.getSubscription())) return { ok: true, via: 'service-worker' };
      // o clique é tratado pelo service worker (sw.js): traz o painel para a frente e abre a tela do aviso
      await reg.showNotification(notice.title, options);
      return { ok: true, via: 'service-worker' };
    } catch (err) {
      swError = err instanceof Error ? err.message : String(err);
    }
  }
  try {
    const n = new Notification(notice.title, { body, icon: '/icon-192.png', tag: notice.tag, requireInteraction: Boolean(notice.keep) });
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
    return { ok: true, via: 'navegador' };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `O navegador recusou a notificação (${swError || detail}).` };
  }
}

export type NoticeEnvironment = {
  os: 'windows' | 'mac' | 'linux' | 'android' | 'ios' | 'outro';
  browser: 'chrome' | 'edge' | 'firefox' | 'safari' | 'opera' | 'brave' | 'outro';
};

/** Navegador e sistema operacional, para orientar onde liberar as notificações. */
export function detectEnvironment(
  ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  opts: { brave?: boolean; touchPoints?: number } = {
    brave: typeof navigator !== 'undefined' && Boolean((navigator as { brave?: unknown }).brave),
    touchPoints: typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
  },
): NoticeEnvironment {
  const os: NoticeEnvironment['os'] = /Android/i.test(ua)
    ? 'android'
    : /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && (opts.touchPoints ?? 0) > 1)
      ? 'ios'
      : /Windows/i.test(ua)
        ? 'windows'
        : /Macintosh|Mac OS X/i.test(ua)
          ? 'mac'
          : /Linux|X11|CrOS/i.test(ua)
            ? 'linux'
            : 'outro';
  const browser: NoticeEnvironment['browser'] = opts.brave
    ? 'brave'
    : /Edg(e|A|iOS)?\//i.test(ua)
      ? 'edge'
      : /OPR\/|Opera/i.test(ua)
        ? 'opera'
        : /Firefox|FxiOS/i.test(ua)
          ? 'firefox'
          : /Chrome|CriOS|Chromium/i.test(ua)
            ? 'chrome'
            : /Safari/i.test(ua)
              ? 'safari'
              : 'outro';
  return { os, browser };
}

/**
 * Endereço das configurações de notificações do navegador (o navegador não deixa uma página abrir esse
 * endereço: a pessoa cola na barra de endereço). null: sem endereço próprio (Safari, outros).
 */
export function browserSettingsUrl(browser: NoticeEnvironment['browser'], origin: string): string | null {
  const site = encodeURIComponent(origin);
  switch (browser) {
    case 'chrome':
      return `chrome://settings/content/siteDetails?site=${site}`;
    case 'edge':
      return `edge://settings/content/siteDetails?site=${site}`;
    case 'brave':
      return `brave://settings/content/siteDetails?site=${site}`;
    case 'opera':
      return 'opera://settings/content/notifications';
    case 'firefox':
      return 'about:preferences#privacy';
    default:
      return null;
  }
}

/** Link que abre as configurações de notificações do sistema (o navegador pede confirmação). null: sem link. */
export function osSettingsLink(os: NoticeEnvironment['os']): string | null {
  switch (os) {
    case 'windows':
      return 'ms-settings:notifications';
    case 'mac':
      return 'x-apple.systempreferences:com.apple.Notifications-Settings.extension';
    default:
      return null;
  }
}
