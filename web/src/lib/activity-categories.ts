/** Categorias do log de atividades (nome e cor), usadas no Log e nas atividades de um usuário (Acompanhamento). */
type ActivityTone = 'neutral' | 'brand' | 'good' | 'warning' | 'critical';

export const ACTIVITY_CATEGORIES: Record<string, { label: string; tone: ActivityTone }> = {
  acesso: { label: 'Acesso', tone: 'neutral' },
  usuarios: { label: 'Usuários', tone: 'warning' },
  equipe: { label: 'Equipe', tone: 'warning' },
  configuracoes: { label: 'Configurações', tone: 'brand' },
  grupos: { label: 'Grupos', tone: 'brand' },
  atendimento: { label: 'Atendimento', tone: 'good' },
  demandas: { label: 'Demandas', tone: 'good' },
  alertas: { label: 'Alertas', tone: 'good' },
  empresas: { label: 'Empresas', tone: 'critical' },
};
