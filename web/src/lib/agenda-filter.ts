/**
 * Filtro da agenda (?quem=a,b e ?setor=x,y): lê os parâmetros, descarta o que não existe e junta os usuários escolhidos
 * com as pessoas dos setores escolhidos. Sem escolha nenhuma, é a própria agenda.
 */

export type AgendaPerson = { id: string; name: string; member_ids?: string[] };
export type AgendaTeamRef = { id: string; name: string; userIds: string[] };

export type AgendaFilterState = {
  /** usuários escolhidos (válidos) */
  selectedUsers: string[];
  /** setores escolhidos (válidos) */
  selectedTeams: AgendaTeamRef[];
  filtering: boolean;
  /** de quem são os compromissos mostrados */
  userIds: string[];
  /** olhando mais do que a própria agenda */
  viewingOther: boolean;
  multi: boolean;
  /** frase para "na agenda de ..." */
  label: string;
};

const asList = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v.join(',') : (v ?? '')).split(',').map((x) => x.trim()).filter(Boolean);

export function parseAgendaFilter(
  sp: { quem?: string | string[]; setor?: string | string[] },
  people: AgendaPerson[],
  teams: AgendaTeamRef[],
  meId: string,
): AgendaFilterState {
  const selectedUsers = [...new Set(asList(sp.quem))].filter((id) => people.some((p) => p.id === id));
  const selectedTeams = [...new Set(asList(sp.setor))].flatMap((id) => teams.filter((t) => t.id === id));
  const filtering = selectedUsers.length + selectedTeams.length > 0;
  const userIds = filtering ? [...new Set([...selectedUsers, ...selectedTeams.flatMap((t) => t.userIds)])] : [meId];
  const viewingOther = userIds.length !== 1 || userIds[0] !== meId;
  const names = [
    ...selectedTeams.map((t) => `setor ${t.name}`),
    ...selectedUsers.map((id) => (id === meId ? 'minha agenda' : (people.find((p) => p.id === id)?.name ?? 'usuário'))),
  ];
  const label = names.length > 3 ? `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}` : names.join(', ');
  return { selectedUsers, selectedTeams, filtering, userIds, viewingOther, multi: userIds.length > 1, label };
}

/** Pessoas da equipe (demandas) dos usuários mostrados; a própria agenda também usa as ligações do próprio usuário. */
export function memberIdsOf(state: Pick<AgendaFilterState, 'filtering' | 'userIds'>, people: AgendaPerson[], meId: string, myIds: string[]): string[] {
  if (!state.filtering) return myIds;
  return [...new Set([...state.userIds.flatMap((u) => people.find((p) => p.id === u)?.member_ids ?? []), ...(state.userIds.includes(meId) ? myIds : [])])];
}
