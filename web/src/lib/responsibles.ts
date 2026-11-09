/**
 * Administradores como responsáveis de todos os grupos (0162): só o texto que as telas mostram.
 * Sem dependências, para as telas e os testes usarem o mesmo código.
 */

/** Rótulo que acompanha os responsáveis escolhidos no grupo quando a opção está ligada. */
export const ADMINS_LABEL = 'administradores';

/**
 * Responsáveis do grupo para mostrar: os escolhidos mais "administradores" quando a opção da empresa está ligada.
 * Grupo sem responsável escolhido continua sem nomes (para achar os grupos sem dono).
 */
export function withAdmins(names: string[], adminsOn: boolean): string[] {
  if (!adminsOn || names.length === 0 || names.includes(ADMINS_LABEL)) return names;
  return [...names, ADMINS_LABEL];
}

/** Um administrador (pessoa da equipe) é responsável por todos os grupos quando a opção está ligada. */
export function matchesResponsible(opts: { selected: string; groupResponsibleIds: string[]; adminIds: string[] }): boolean {
  return opts.groupResponsibleIds.includes(opts.selected) || opts.adminIds.includes(opts.selected);
}
