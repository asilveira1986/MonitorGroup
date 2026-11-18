/** Situação das notificações de um usuário (0189), para a tela do administrador geral. */
export type NotificationRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  company_id: string | null;
  company_name: string | null;
  alerts_off: boolean;
  push_prefs: Record<string, boolean>;
  last_seen_at: string | null;
  devices: number;
  devices_ok: number;
  last_push_ok_at: string | null;
  max_failures: number;
};

/**
 * ok: avisos ligados e com push entregando (chega até com o sistema fechado);
 * screen: avisos ligados, mas sem push — só avisa com o sistema aberto;
 * failing: tem aparelho com push, mas todos falhando;
 * off: o usuário desligou os avisos.
 */
export type NotificationState = 'ok' | 'screen' | 'failing' | 'off';

export function notificationState(r: Pick<NotificationRow, 'alerts_off' | 'devices' | 'devices_ok'>): NotificationState {
  if (r.alerts_off) return 'off';
  if (r.devices_ok > 0) return 'ok';
  return r.devices > 0 ? 'failing' : 'screen';
}

export const STATE_LABEL: Record<NotificationState, string> = {
  ok: 'Ativas (tela e push)',
  screen: 'Só com o sistema aberto',
  failing: 'Push falhando',
  off: 'Desligadas',
};

const KIND_LABEL: Record<string, string> = { alert: 'Alertas dos grupos', demand: 'Demandas', agenda: 'Agenda', private: 'Conversas privadas' };

/** Tipos de push que o usuário desmarcou (vazio = todos ligados). */
export function mutedKinds(prefs: Record<string, boolean> | null | undefined): string[] {
  return Object.entries(prefs ?? {})
    .filter(([k, v]) => v === false && KIND_LABEL[k])
    .map(([k]) => KIND_LABEL[k]);
}

/** Aberto agora: último acesso há menos de 5 minutos (o sistema aberto avisa a cada 2). */
export function isOnline(lastSeen: string | null, now: number): boolean {
  return Boolean(lastSeen) && now - new Date(lastSeen as string).getTime() < 5 * 60_000;
}
