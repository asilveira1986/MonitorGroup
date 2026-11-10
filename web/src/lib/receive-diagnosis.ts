/**
 * Diagnóstico de recebimento de um grupo (0165): transforma o que o banco devolve em frases para o administrador.
 * Responde "o número parou de receber?", "só este grupo?", "está chegando por outra cópia?" e "chegou sem poder abrir?".
 */

export type ReceiveDiagnosis = {
  group: {
    last_message_at: string | null;
    monitored: boolean;
    removed_at: string | null;
    undecrypted_count: number;
    last_undecrypted_at: string | null;
    last_undecrypted_reason: string | null;
  };
  instance: {
    name: string;
    phone: string | null;
    status: string;
    last_seen_at: string | null;
    connected_at: string | null;
    last_error: string | null;
    last_message_at: string | null;
    groups_active_24h: number;
  } | null;
  copies: { name: string; phone: string | null; status: string; monitored: boolean; removed_at: string | null; last_message_at: string | null }[];
  auto_request: { status: string; created_at: string; messages_added: number; note: string | null } | null;
};

/** `sync`: a outra cópia tem mensagens que esta não tem; o painel oferece "Sincronizar agora" (0166). */
export type Finding = { tone: 'good' | 'warning' | 'critical' | 'neutral'; text: string; action?: 'sync' };

const HOUR = 3600_000;
const STATUS: Record<string, string> = { disconnected: 'desconectado', connecting: 'conectando', qr: 'esperando a leitura do QR Code', connected: 'conectado' };

/** Frases do diagnóstico, da mais grave para a informativa. `fmt` formata data/hora (fuso da empresa). */
export function diagnose(d: ReceiveDiagnosis, now: number, fmt: (iso: string) => string): Finding[] {
  const out: Finding[] = [];
  const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : null);
  const groupLast = ms(d.group.last_message_at);
  const groupStale = groupLast === null || now - groupLast > 24 * HOUR;
  const i = d.instance;

  if (d.group.removed_at) out.push({ tone: 'critical', text: 'O número conectado não participa mais deste grupo: nada novo chega por ele.' });
  if (!i) {
    out.push({ tone: 'critical', text: 'O grupo não está ligado a nenhum número conectado.' });
  } else {
    const label = `O número ${i.name}${i.phone ? ` (${i.phone})` : ''}`;
    const instLast = ms(i.last_message_at);
    if (i.status !== 'connected') {
      out.push({ tone: 'critical', text: `${label} está ${STATUS[i.status] ?? i.status}: nenhuma mensagem chega enquanto ele não for reconectado (menu Conexões).` });
    } else if (instLast === null || now - instLast > 24 * HOUR) {
      out.push({
        tone: 'critical',
        text: `${label} aparece conectado, mas não guarda mensagem de nenhum grupo desde ${instLast ? fmt(i.last_message_at!) : 'sempre'}. A conexão travou: desconecte e conecte de novo em Conexões.`,
      });
    } else if (groupStale) {
      out.push({
        tone: 'warning',
        text: `${label} recebe outros grupos normalmente (${i.groups_active_24h} com mensagens nas últimas 24 h), mas nada deste grupo desde ${groupLast ? fmt(d.group.last_message_at!) : 'sempre'}.`,
      });
    }
  }

  for (const c of d.copies) {
    const cl = ms(c.last_message_at);
    if (cl !== null && (groupLast === null || cl > groupLast)) {
      out.push({
        tone: 'warning',
        text:
          `A cópia deste grupo no número ${c.name}${c.phone ? ` (${c.phone})` : ''} recebeu mensagem em ${fmt(c.last_message_at!)}: as mensagens novas estão chegando por lá` +
          (c.monitored ? '. ' : ' (essa cópia está sem monitoramento). ') +
          'O sistema copia entre as cópias do grupo o que só uma delas recebeu, de minuto em minuto; para trazer agora, use "Sincronizar setores", ao lado de "Recuperar mensagens".',
        action: 'sync',
      });
    }
  }

  if (d.group.undecrypted_count > 0) {
    out.push({
      tone: 'warning',
      text:
        `${d.group.undecrypted_count} mensagem(ns) deste grupo chegaram, mas o número conectado não conseguiu abrir` +
        `${d.group.last_undecrypted_at ? ` (a última em ${fmt(d.group.last_undecrypted_at)})` : ''}. ` +
        'Costuma ser a chave de segurança do grupo desatualizada no aparelho conectado: peça para alguém do grupo mandar uma mensagem; se continuar, desconecte e conecte o número de novo.',
    });
  }

  if (d.auto_request) {
    const a = d.auto_request;
    const state =
      a.status === 'pending' || a.status === 'running'
        ? 'em andamento'
        : a.status === 'done'
          ? `concluída (${a.messages_added} mensagem(ns) nova(s))`
          : a.status === 'failed'
            ? 'não deu certo'
            : 'cancelada';
    out.push({ tone: 'neutral', text: `Recuperação automática do intervalo sem mensagens, pedida em ${fmt(a.created_at)}: ${state}.` });
  }

  if (!out.some((f) => f.tone === 'critical' || f.tone === 'warning')) out.unshift({ tone: 'good', text: 'Recebimento normal: o número está conectado e este grupo recebeu mensagens recentemente.' });
  return out;
}

/** Texto honesto sobre o limite da recuperação, com a data da última mensagem guardada. */
export function recoveryLimitText(lastStored: string | null, fmt: (iso: string) => string): string {
  return lastStored
    ? `A recuperação busca o que veio ANTES da última mensagem guardada (${fmt(lastStored)}). O que chegou depois dela não tem como ser pedido ao celular: entra pelo número conectado, e quando a próxima mensagem chegar o sistema pede o intervalo sozinho.`
    : 'A recuperação precisa de pelo menos uma mensagem guardada no grupo para servir de ponto de partida.';
}
