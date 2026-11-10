import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearPanelFilters, defaultPanelSector, PANEL_STORAGE_KEYS } from './panel-defaults.ts';

test('painel: administradores abrem sempre com o setor Todos, mesmo com setor Geral e sem grupos próprios', () => {
  assert.equal(defaultPanelSector({ isAdmin: true, hasOwnGroups: false, generalSectorId: 'geral-1' }), 'all');
  assert.equal(defaultPanelSector({ isAdmin: true, hasOwnGroups: true, generalSectorId: 'geral-1' }), 'all');
  assert.equal(defaultPanelSector({ isAdmin: true, hasOwnGroups: false, generalSectorId: null }), 'all');
});

test('painel: quem não é administrador mantém o comportamento de antes', () => {
  // com grupos próprios: Todos
  assert.equal(defaultPanelSector({ isAdmin: false, hasOwnGroups: true, generalSectorId: 'geral-1' }), 'all');
  // sem grupos próprios: setor Geral, se existir
  assert.equal(defaultPanelSector({ isAdmin: false, hasOwnGroups: false, generalSectorId: 'geral-1' }), 'geral-1');
  assert.equal(defaultPanelSector({ isAdmin: false, hasOwnGroups: false, generalSectorId: null }), 'all');
});

test('painel: limpar os filtros guardados apaga só as chaves do painel e aguenta armazenamento ausente ou quebrado', () => {
  const removed: string[] = [];
  clearPanelFilters({ removeItem: (k) => void removed.push(k) });
  assert.deepEqual(removed, [...PANEL_STORAGE_KEYS]);
  assert.doesNotThrow(() => clearPanelFilters(null));
  assert.doesNotThrow(() => clearPanelFilters(undefined));
  assert.doesNotThrow(() =>
    clearPanelFilters({
      removeItem: () => {
        throw new Error('bloqueado');
      },
    }),
  );
});
