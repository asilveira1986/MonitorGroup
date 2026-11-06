import type { BroadcastSettings } from './types.js';

/** Regras puras dos disparos (sem banco nem WhatsApp). */

export const DEFAULT_SETTINGS: BroadcastSettings = { minDelayS: 8, maxDelayS: 25, batchSize: 40, batchPauseMin: 5, dailyLimit: 200 };

const int = (v: unknown, fallback: number, min: number, max: number): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

/** Configuração da empresa com limites seguros (nunca abaixo de 3 s entre mensagens). */
export function normalizeSettings(row: Record<string, unknown> | null | undefined): BroadcastSettings {
  const d = DEFAULT_SETTINGS;
  const minDelayS = int(row?.broadcast_min_delay_s, d.minDelayS, 3, 600);
  const maxDelayS = Math.max(minDelayS, int(row?.broadcast_max_delay_s, d.maxDelayS, 3, 1800));
  return {
    minDelayS,
    maxDelayS,
    batchSize: int(row?.broadcast_batch_size, d.batchSize, 5, 500),
    batchPauseMin: int(row?.broadcast_batch_pause_min, d.batchPauseMin, 1, 120),
    dailyLimit: int(row?.broadcast_daily_limit, d.dailyLimit, 1, 5000),
  };
}

/** Variáveis: {nome}, {primeiro_nome} e {grupo}. Sem o dado, a variável some e o espaço sobrando também. */
export function renderMessage(template: string, who: { name?: string | null }): string {
  const name = (who.name ?? '').trim();
  const first = name.split(/\s+/)[0] ?? '';
  const out = template
    .replace(/\{\s*primeiro_nome\s*\}/gi, first)
    .replace(/\{\s*nome\s*\}/gi, name)
    .replace(/\{\s*grupo\s*\}/gi, name);
  // "Olá {nome}, tudo bem?" sem nome vira "Olá, tudo bem?"
  return out.replace(/[ \t]+([,.!?;:])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
}

/** Intervalo até a próxima mensagem (ms), aleatório entre o mínimo e o máximo. */
export function pickDelayMs(s: BroadcastSettings, rand: () => number = Math.random): number {
  return Math.round((s.minDelayS + rand() * (s.maxDelayS - s.minDelayS)) * 1000);
}

/** Pausa longa entre lotes (ms), com até 20% de variação. */
export function batchPauseMs(s: BroadcastSettings, rand: () => number = Math.random): number {
  return Math.round(s.batchPauseMin * 60_000 * (1 + rand() * 0.2));
}

/** Tempo de "digitando…" antes de enviar, proporcional ao texto (entre 1 e 4 s). */
export function typingMs(text: string): number {
  return Math.min(4000, Math.max(1000, text.length * 25));
}

/** Erros de dado do destinatário (não contam como problema do número). */
export class RecipientError extends Error {}
