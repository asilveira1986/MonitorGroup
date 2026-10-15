import type { Role } from '@/lib/types';

/** Perfis de usuário (Configurações › Usuários). */
export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  agent: 'Atendente',
  viewer: 'Somente ver painéis',
};

export const ROLE_HINT: Record<Role, string> = {
  admin: 'Acesso total à empresa: configurações, usuários, regras e todos os grupos.',
  agent: 'Atende os grupos dos seus setores: responde, cria demandas e trata alertas, conforme o setor.',
  viewer: 'Só acompanha: vê o Dashboard, o Painel de grupos e as conversas dos grupos dos seus setores, sem alterar nada. Bom para gestores e TVs.',
};

/** Menus que o perfil "somente ver painéis" enxerga. */
export const VIEWER_MENUS = ['/dashboard', '/panel'];
