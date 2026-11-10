/**
 * Como o Painel de grupos abre (setor e filtros). Sem dependências, para a tela e os testes usarem o mesmo código.
 */

/** Chaves que o painel guarda no navegador (sessionStorage) com os filtros escolhidos. */
export const PANEL_STORAGE_KEYS = ['panel-filters', 'panel-responsible'] as const;

/**
 * Setor que o painel abre selecionado ('all' = Todos):
 *  - administradores da empresa (e da plataforma): sempre Todos;
 *  - quem abre já nos próprios grupos (é responsável por algum): Todos, para não esconder grupo de outro setor;
 *  - os demais: o setor padrão "Geral", se existir; senão Todos.
 */
export function defaultPanelSector(opts: { isAdmin: boolean; hasOwnGroups: boolean; generalSectorId: string | null }): string {
  if (opts.isAdmin || opts.hasOwnGroups) return 'all';
  return opts.generalSectorId ?? 'all';
}

/** Esquece os filtros guardados do painel: o próximo login abre no padrão, sem herdar a escolha de quem usou antes. */
export function clearPanelFilters(storage: Pick<Storage, 'removeItem'> | null | undefined): void {
  if (!storage) return;
  for (const key of PANEL_STORAGE_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      /* sem armazenamento da sessão */
    }
  }
}
