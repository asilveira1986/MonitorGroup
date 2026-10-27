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
    group: 'Empresa',
    items: [
      { href: '/settings', label: 'Dados da empresa', description: 'Nome, logo, horário comercial, feriados e histórico' },
      { href: '/settings/menus', label: 'Menus', description: 'Itens do menu lateral para cada perfil', adminOnly: true },
      { href: '/settings/lgpd', label: 'Privacidade (LGPD)', description: 'Prazo de guarda das mensagens e pedidos dos titulares', adminOnly: true, platformOnly: true },
    ],
  },
  {
    group: 'Pessoas',
    items: [
      { href: '/settings/people', label: 'Pessoas', description: 'Quem atende nos grupos e quem entra no painel, num cadastro só', check: 'users' },
      { href: '/settings/sectors', label: 'Setores', description: 'Quem vê cada grupo e as equipes da agenda', adminOnly: true, check: 'sectors' },
    ],
  },
  {
    group: 'WhatsApp',
    items: [
      { href: '/settings/whatsapp', label: 'Conexão e arquivos', description: 'Conexão, histórico e arquivos recebidos', check: 'whatsapp' },
      { href: '/settings/atendimento', label: 'Respostas e mensagens', description: 'Responder pelo sistema e o que ignorar' },
      { href: '/settings/quick-replies', label: 'Mensagens rápidas', description: 'Atalhos com \\ na resposta', check: 'quickReplies' },
      { href: '/settings/notices', label: 'Avisos automáticos', description: 'O que o sistema manda sozinho: ao cliente e à equipe' },
    ],
  },
  {
    group: 'Atendimento',
    items: [
      { href: '/settings/demand-types', label: 'Demandas', description: 'Tipos e como as demandas são criadas' },
      { href: '/settings/agenda-types', label: 'Agenda', description: 'Tipos de compromisso e a cor de cada um', adminOnly: true },
      { href: '/settings/tags', label: 'Etiquetas', description: 'Etiquetas para marcar os clientes nos grupos e no privado', adminOnly: true },
    ],
  },
  {
    group: 'Monitoramento',
    items: [
      { href: '/settings/alerts', label: 'Regras de alerta', description: 'Quando um alerta é criado e por onde avisar', check: 'alertRules' },
      { href: '/settings/avisos', label: 'Avisos em tela e voz', description: 'Aviso em tela, som e aviso por voz' },
      { href: '/settings/indicators', label: 'Indicadores', description: 'O que aparece no dashboard e nos relatórios', adminOnly: true },
    ],
  },
];
