/** Cores dos tipos de compromisso (0102): legíveis no tema claro e no escuro. */
export const AGENDA_COLORS = {
  blue: { hex: '#3b82f6', label: 'Azul' },
  green: { hex: '#16a34a', label: 'Verde' },
  orange: { hex: '#ea580c', label: 'Laranja' },
  red: { hex: '#dc2626', label: 'Vermelho' },
  purple: { hex: '#9333ea', label: 'Roxo' },
  pink: { hex: '#db2777', label: 'Rosa' },
  teal: { hex: '#0d9488', label: 'Verde-água' },
  yellow: { hex: '#ca8a04', label: 'Amarelo' },
  gray: { hex: '#64748b', label: 'Cinza' },
} as const;

export type AgendaColor = keyof typeof AGENDA_COLORS;
export type AgendaType = { id: string; name: string; color: AgendaColor };

/** cor do compromisso: a do tipo; sem tipo, o azul padrão da agenda */
export const agendaColor = (color: string | null | undefined) => AGENDA_COLORS[(color as AgendaColor) ?? 'blue']?.hex ?? AGENDA_COLORS.blue.hex;
