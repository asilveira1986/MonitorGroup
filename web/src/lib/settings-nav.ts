/**
 * Menu das Configurações, agrupado por assunto e na ordem de quem configura do zero:
 * empresa → WhatsApp → pessoas → atendimento → alertas.
 */
export type SettingsCheck = 'whatsapp' | 'users' | 'team' | 'sectors' | 'quickReplies' | 'alertRules';

export type SettingsItem = {
  href: string;
  label: string;
  description: string;
  adminOnly?: boolean;
  /** só quem administra a plataforma (administrador geral do sistema) */
  platformOnly?: boolean;
  /** item que mostra ✓ quando já foi configurado */
  check?: SettingsCheck;
};

export const SETTINGS_NAV: { group: string; items: SettingsItem[] }[] = [
  {
    group: 'Organização',
    items: [
      { href: '/settings', label: 'Empresa', description: 'Horário comercial, feriados e histórico' },
      { href: '/settings/users', label: 'Acessos ao painel', description: 'Quem entra no sistema e com qual perfil', check: 'users' },
      { href: '/settings/team', label: 'Atendentes', description: 'Quem responde nos grupos pelo WhatsApp', check: 'team' },
      { href: '/settings/sectors', label: 'Setores', description: 'Quais grupos cada pessoa vê e o que pode fazer', adminOnly: true, check: 'sectors' },
      { href: '/settings/agenda-teams', label: 'Setores da agenda', description: 'Grupos de pessoas para marcar compromissos de uma vez', adminOnly: true },
      { href: '/settings/agenda-types', label: 'Tipos de compromisso', description: 'Os tipos da agenda e a cor de cada um', adminOnly: true },
      { href: '/settings/tags', label: 'Etiquetas', description: 'Etiquetas para marcar os clientes nos grupos e no privado', adminOnly: true },
      { href: '/settings/lgpd', label: 'Privacidade (LGPD)', description: 'Prazo de guarda das mensagens e pedidos dos titulares', adminOnly: true, platformOnly: true },
    ],
  },
  {
    group: 'Canais',
    items: [{ href: '/settings/whatsapp', label: 'WhatsApp', description: 'Conexão, histórico e arquivos recebidos', check: 'whatsapp' }],
  },
  {
    group: 'Atendimento',
    items: [
      { href: '/settings/demand-types', label: 'Demandas', description: 'Tipos e como as demandas são criadas' },
      { href: '/settings/atendimento', label: 'Respostas e mensagens', description: 'Responder pelo sistema e o que ignorar' },
      { href: '/settings/quick-replies', label: 'Mensagens rápidas', description: 'Atalhos com \\ na resposta', check: 'quickReplies' },
      { href: '/settings/menus', label: 'Menus', description: 'Itens do menu lateral para cada perfil', adminOnly: true },
    ],
  },
  {
    group: 'Monitoramento',
    items: [
      { href: '/settings/alerts', label: 'Regras de alerta', description: 'Quando um alerta é criado e por onde avisar', check: 'alertRules' },
      { href: '/settings/avisos', label: 'Avisos (tela e voz)', description: 'Aviso em tela, som e aviso por voz' },
      { href: '/settings/indicators', label: 'Indicadores', description: 'O que aparece no dashboard e nos relatórios', adminOnly: true },
    ],
  },
];
