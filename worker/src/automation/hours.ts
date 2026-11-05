import { isWithinBusinessHours } from '../business-hours.js';

/** Fuso do atendimento quando a empresa não tem um configurado. */
export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Está dentro do horário de atendimento da regra? Calculado no fuso do atendimento (Intl), não no fuso do
 * servidor: um servidor em UTC dá o mesmo resultado. O início vale; o fim não (18:00 já é fora).
 */
export function isBusinessHours(
  rule: { businessDays: number[]; businessStart: string; businessEnd: string },
  date: Date,
  timezone: string = DEFAULT_TIMEZONE,
): boolean {
  return isWithinBusinessHours(date, {
    timezone,
    businessDays: rule.businessDays,
    start: rule.businessStart,
    end: rule.businessEnd,
  });
}
