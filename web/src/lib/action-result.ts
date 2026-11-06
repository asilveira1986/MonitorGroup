import { friendlyDbError } from '@/lib/db-errors';

/** Resultado de uma ação do servidor: deu certo, ou o motivo para mostrar na tela. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Resultado de uma gravação a partir do erro do banco. Traduz o erro de "script SQL ainda não rodado" numa
 * explicação em português (veja db-errors.ts).
 */
export const dbResult = (error: { message: string } | null | undefined): ActionResult =>
  error ? { ok: false, error: friendlyDbError(error.message) } : { ok: true };
