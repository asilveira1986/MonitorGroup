import { Building2, ChevronRight, Info, ShieldCheck, UserRound, Users } from 'lucide-react';
import { AdminNotice } from '@/components/admin-notice';
import { RowMenu, type RowAction } from '@/components/disclosure';
import { ImageUpload } from '@/components/image-upload';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { formatPhone } from '@/lib/format';
import { ROLE_HINT, ROLE_LABEL } from '@/lib/roles';
import { createClient } from '@/lib/supabase/server';
import type { Profile, TeamMember } from '@/lib/types';
import { deleteUser, prepareImageUpload, removeAllowedEmail, removeTeamMember, saveTeamPhoto, updateUser } from '../actions';
import { AlertScope } from '../team/alert-scope';
import { GrantAccess } from '../team/grant-access';
import { RecalcButton } from '../team/recalc-button';
import { RoleSelect } from '../users/role-select';
import { EditPerson, GeneratePasswordButton, MakeAttendantButton, NewPersonDialog } from './person-forms';

type Person = { key: string; name: string; email: string | null; phone: string | null; profile?: Profile; member?: TeamMember };

/**
 * Organização › Pessoas (0107): um cadastro só para quem atende nos grupos (atendente) e quem entra
 * no painel (acesso). A mesma pessoa aparece uma vez, ligada pelo e-mail, com nome e telefone iguais
 * nos dois.
 */
export default async function PeoplePage() {
  const me = await requireProfile();
  const isAdmin = me.role === 'admin' || me.platform_admin;
  const supabase = await createClient();
  const [{ data: profiles }, { data: allowed }, { data: team }, { data: groupRows }, { data: sectorRows }, { data: memberRows }] = await Promise.all([
    isAdmin ? supabase.from('profiles').select('*').order('created_at') : Promise.resolve({ data: [] }),
    isAdmin ? supabase.from('allowed_emails').select('*').order('created_at') : Promise.resolve({ data: [] }),
    supabase.from('team_members').select('*').order('name'),
    supabase.from('groups').select('responsible_member_ids').is('removed_at', null),
    // setores e quem é de cada um (administradores)
    isAdmin ? supabase.from('sectors').select('id, name').order('name') : Promise.resolve({ data: [] }),
    isAdmin ? supabase.from('sector_members').select('sector_id, user_id') : Promise.resolve({ data: [] }),
  ]);
  const sectors = (sectorRows ?? []) as { id: string; name: string }[];
  const sectorsOf = new Map<string, string[]>();
  for (const r of (memberRows ?? []) as { sector_id: string; user_id: string }[]) sectorsOf.set(r.user_id, [...(sectorsOf.get(r.user_id) ?? []), r.sector_id]);
  // quem administra a plataforma e está aqui para suporte não aparece para a empresa
  const users = ((profiles ?? []) as Profile[]).filter((u) => me.platform_admin || !u.platform_admin);
  const members = (team ?? []) as TeamMember[];
  const groupsOf = new Map<string, number>();
  for (const g of (groupRows ?? []) as { responsible_member_ids: string[] | null }[])
    for (const id of g.responsible_member_ids ?? []) groupsOf.set(id, (groupsOf.get(id) ?? 0) + 1);

  // junta acesso e atendente pelo e-mail
  const byEmail = new Map<string, Person>();
  const people: Person[] = [];
  for (const u of users) {
    const p: Person = { key: `u${u.id}`, name: u.full_name || u.email.split('@')[0], email: u.email, phone: u.phone ?? null, profile: u };
    byEmail.set(u.email.toLowerCase(), p);
    people.push(p);
  }
  for (const m of members) {
    const linked = m.user_email ? byEmail.get(m.user_email.toLowerCase()) : undefined;
    if (linked) {
      linked.member = m;
      linked.name = m.name || linked.name;
      linked.phone = m.phone ?? linked.phone;
    } else people.push({ key: `m${m.id}`, name: m.name, email: m.user_email ?? null, phone: m.phone, member: m });
  }
  people.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const invites = ((allowed ?? []) as { email: string; role: string }[]).filter((a) => !users.some((u) => u.email === a.email));

  const actionsFor = (p: Person): RowAction[] => {
    const u = p.profile;
    const m = p.member;
    return [
      ...(u && u.id !== me.id
        ? [
            u.active
              ? { label: 'Bloquear acesso ao painel', action: removeAllowedEmail.bind(null, u.email), confirm: `Bloquear o acesso de ${u.email}?`, success: 'Acesso bloqueado' }
              : { label: 'Liberar acesso ao painel', action: updateUser.bind(null, u.id, { active: true }), success: 'Acesso liberado' },
          ]
        : []),
      ...(m?.photo_path ? [{ label: 'Tirar a foto', action: saveTeamPhoto.bind(null, m.id, null), success: 'Foto retirada' }] : []),
      ...(m
        ? [
            {
              label: 'Deixar de atender nos grupos',
              danger: true,
              action: removeTeamMember.bind(null, m.id),
              confirm: `${p.name} deixa de ser da equipe nos grupos?${u ? '\n\nO acesso ao painel continua.' : ''}`,
              success: 'Deixou de atender nos grupos',
            },
          ]
        : []),
      ...(u && me.platform_admin && u.id !== me.id
        ? [
            {
              label: 'Excluir usuário',
              danger: true,
              action: deleteUser.bind(null, u.id),
              confirm: `Excluir de vez o usuário ${u.email}?\n\nO login e o perfil são apagados e não dá para desfazer. O histórico (demandas, alertas e log) continua com o nome dele.`,
              success: 'Usuário excluído',
            },
          ]
        : []),
    ];
  };

  const withAccess = people.filter((p) => p.profile).length;
  const attending = people.filter((p) => p.member).length;

  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <Card>
        <CardHeader
          title="Pessoas"
          description={`${people.length} pessoa(s) · ${attending} atendem nos grupos · ${withAccess} entram no painel`}
          action={
            <div className="flex flex-wrap items-center gap-1">
              {isAdmin && <RecalcButton />}
              {isAdmin && <NewPersonDialog sectors={sectors} />}
            </div>
          }
        />
        <ul className="divide-y divide-line border-t border-line">
          {people.map((p) => {
            const u = p.profile;
            const m = p.member;
            const menu = isAdmin ? actionsFor(p) : [];
            return (
              <li key={p.key} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-5">
                {m ? (
                  <ImageUpload
                    compact
                    round
                    size="h-9 w-9"
                    label={`Foto de ${p.name}`}
                    src={m.photo_path ? `/team-photo/${m.id}` : null}
                    prepare={prepareImageUpload.bind(null, 'team')}
                    save={saveTeamPhoto.bind(null, m.id)}
                    disabled={me.role === 'viewer'}
                    fallback={
                      <span className="flex h-full w-full items-center justify-center bg-brand-soft text-xs font-semibold text-brand-text">
                        {p.name.slice(0, 2).toUpperCase()}
                      </span>
                    }
                  />
                ) : (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-2 text-ink-2">
                    {u?.photo_path ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/profile-photo/${u.id}`} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <UserRound className="h-4 w-4" />
                    )}
                  </span>
                )}
                <div className="min-w-0 flex-1 basis-56">
                  <p className="truncate text-sm font-medium">
                    {p.name} {u?.id === me.id && <span className="font-normal text-muted">(você)</span>}
                  </p>
                  <p className="truncate text-xs text-muted">
                    {[p.phone ? formatPhone(p.phone) : m ? 'WhatsApp identificado pela conversa' : null, p.email].filter(Boolean).join(' · ')}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-1">
                    {m && (
                      <Badge tone="good">
                        <Users className="h-3 w-3" /> Atende nos grupos
                        {groupsOf.get(m.id) ? ` · responsável por ${groupsOf.get(m.id)}` : ''}
                      </Badge>
                    )}
                    {u && !u.active && <Badge tone="critical">Sem acesso</Badge>}
                    {u &&
                      (sectorsOf.get(u.id) ?? [])
                        .map((id) => sectors.find((s) => s.id === id)?.name)
                        .filter(Boolean)
                        .map((name) => (
                          <Badge key={name} tone="info">
                            <Building2 className="h-3 w-3" /> {name}
                          </Badge>
                        ))}
                    {!u && <Badge tone="neutral">Sem acesso ao painel</Badge>}
                  </p>
                </div>
                <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                  {u &&
                    (u.id === me.id || !isAdmin ? (
                      <Badge tone="brand">
                        <ShieldCheck className="h-3 w-3" /> {ROLE_LABEL[u.role]}
                      </Badge>
                    ) : (
                      <span title={ROLE_HINT[u.role]}>
                        <RoleSelect userId={u.id} role={u.role} />
                      </span>
                    ))}
                  {isAdmin && m && !u && <GrantAccess member={m} />}
                  {isAdmin && u && !m && <MakeAttendantButton profileId={u.id} />}
                  {isAdmin && m && <AlertScope member={m} groups={groupsOf.get(m.id) ?? 0} />}
                  {isAdmin && <EditPerson
                      profileId={u?.id ?? null}
                      memberId={m?.id ?? null}
                      name={p.name}
                      phone={p.phone}
                      sectors={sectors}
                      sectorIds={u ? (sectorsOf.get(u.id) ?? []) : []}
                      email={u && (!u.platform_admin || me.platform_admin) ? u.email : null}
                    />}
                  {/* senha nova (a de quem administra a plataforma, só outro administrador da plataforma) */}
                  {isAdmin && u && (!u.platform_admin || me.platform_admin) && <GeneratePasswordButton profileId={u.id} name={p.name} />}
                  {menu.length > 0 && <RowMenu actions={menu} label={`Ações de ${p.name}`} />}
                </div>
              </li>
            );
          })}
          {people.length === 0 && (
            <li>
              <EmptyState icon={<UserRound />} title="Ninguém cadastrado ainda" description="Use “Nova pessoa” para cadastrar quem atende nos grupos e quem entra no painel." />
            </li>
          )}
        </ul>
      </Card>

      {isAdmin && invites.length > 0 && (
        <details className="group rounded-2xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium sm:px-5">
            <ChevronRight className="h-4 w-4 text-muted transition group-open:rotate-90" />
            Convites pendentes <span className="tabular rounded-full bg-surface-2 px-2 text-[11px] text-ink-2">{invites.length}</span>
          </summary>
          <p className="px-4 pb-2 text-xs text-ink-2 sm:px-5">
            E-mails autorizados que ainda não entraram. Sem senha cadastrada, remova e cadastre de novo com uma senha inicial.
          </p>
          <ul className="divide-y divide-line border-t border-line">
            {invites.map((i) => (
              <li key={i.email} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{i.email}</p>
                  <p className="text-xs text-muted">{ROLE_LABEL[i.role as keyof typeof ROLE_LABEL] ?? i.role}</p>
                </div>
                <RowMenu
                  label={`Ações do convite ${i.email}`}
                  actions={[{ label: 'Remover convite', danger: true, action: removeAllowedEmail.bind(null, i.email), success: 'Convite removido' }]}
                />
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="flex items-start gap-1.5 px-1 text-xs text-muted">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          <b>Atende nos grupos</b>: as mensagens dela nos grupos contam como da equipe (as do número conectado já contam).{' '}
          <b>Entra no painel</b>: tem login, com o perfil escolhido. Nome e telefone são os mesmos nos dois e também mudam pelo
          Meu perfil. “Avisos só dos seus grupos”: a pessoa recebe avisos apenas dos grupos em que é responsável e dos grupos sem
          responsável.
        </span>
      </p>
    </div>
  );
}
