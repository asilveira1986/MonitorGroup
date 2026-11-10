// Agenda: particular só como "Ocupado" para os outros (0169). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0169_agenda_personal_busy.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const CO2 = '00000000-0000-0000-0000-0000000000c2';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const ANA = '00000000-0000-0000-0000-0000000000b1';
const BIA = '00000000-0000-0000-0000-0000000000b2';
const CAIO = '00000000-0000-0000-0000-0000000000b3';
const EVA = '00000000-0000-0000-0000-0000000000e1'; // outra empresa
const E_PRO = '00000000-0000-0000-0000-00000000d001';
const E_PERS = '00000000-0000-0000-0000-00000000d002';
const E_PERS_SHARED = '00000000-0000-0000-0000-00000000d003';
const E_PERS_DONE = '00000000-0000-0000-0000-00000000d004';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, role text, active boolean default true);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_active_user() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and active) $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create function public.can_write() returns boolean language sql stable as $$ select true $$;
    create function public.my_team_member_ids() returns uuid[] language sql stable as $$ select '{}'::uuid[] $$;
    create table public.agenda_events (id uuid primary key, company_id uuid, owner_id uuid, created_by uuid, member_id uuid, title text,
      notes text, starts_at timestamptz, all_day boolean default false, done_at timestamptz, nature text);
    create table public.agenda_event_people (event_id uuid, user_id uuid, company_id uuid, primary key (event_id, user_id));
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const day = (n: number) => `now() + interval '${n} days'`;
  await db.exec(`
    insert into public.profiles values ('${ADMIN}', '${CO}', 'admin'), ('${ANA}', '${CO}', 'agent'), ('${BIA}', '${CO}', 'agent'), ('${CAIO}', '${CO}', 'agent'), ('${EVA}', '${CO2}', 'admin');
    insert into public.agenda_events (id, company_id, owner_id, title, notes, starts_at, nature, done_at) values
      ('${E_PRO}', '${CO}', '${ANA}', 'Audiência', 'sala 2', ${day(1)}, 'professional', null),
      ('${E_PERS}', '${CO}', '${ANA}', 'Dentista', 'consulta', ${day(2)}, 'personal', null),
      ('${E_PERS_SHARED}', '${CO}', '${ANA}', 'Almoço com a Bia', 'restaurante', ${day(3)}, 'personal', null),
      ('${E_PERS_DONE}', '${CO}', '${ANA}', 'Passado', null, ${day(4)}, 'personal', now());
    insert into public.agenda_event_people values ('${E_PRO}', '${ANA}', '${CO}'), ('${E_PERS}', '${ANA}', '${CO}'),
      ('${E_PERS_SHARED}', '${ANA}', '${CO}'), ('${E_PERS_SHARED}', '${BIA}', '${CO}'), ('${E_PERS_DONE}', '${ANA}', '${CO}');
  `);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  const can = async (uid: string, ev: string, fn: 'can_see_agenda_event' | 'can_edit_agenda_event') => {
    await as(uid);
    return (await db.query<{ r: boolean }>(`select public.${fn}($1) r`, [ev])).rows[0].r;
  };
  const busy = async (uid: string, users: string[]) => {
    await as(uid);
    return (await db.query<{ r: { starts_at: string; all_day: boolean; user_ids: string[] }[] }>(
      `select public.agenda_busy(now(), now() + interval '30 days', $1::uuid[]) r`, [`{${users.join(',')}}`])).rows[0].r;
  };
  return { db, can, busy };
}

test('administrador vê o profissional de todos, mas não o particular dos outros', async () => {
  const t = await setup();
  assert.equal(await t.can(ADMIN, E_PRO, 'can_see_agenda_event'), true);
  assert.equal(await t.can(ADMIN, E_PERS, 'can_see_agenda_event'), false);
  assert.equal(await t.can(ADMIN, E_PERS, 'can_edit_agenda_event'), false, 'nem edita nem exclui');
  assert.equal(await t.can(ADMIN, E_PRO, 'can_edit_agenda_event'), true);
});

test('o dono e os participantes continuam vendo (e o outro usuário comum não)', async () => {
  const t = await setup();
  assert.equal(await t.can(ANA, E_PERS, 'can_see_agenda_event'), true);
  assert.equal(await t.can(BIA, E_PERS_SHARED, 'can_see_agenda_event'), true, 'participante do particular');
  assert.equal(await t.can(BIA, E_PERS, 'can_see_agenda_event'), false);
  assert.equal(await t.can(CAIO, E_PERS_SHARED, 'can_see_agenda_event'), false);
  assert.equal(await t.can(EVA, E_PRO, 'can_see_agenda_event'), false, 'outra empresa');
});

test('"Ocupado": o administrador recebe só horário e dono, sem título nem observação', async () => {
  const t = await setup();
  const rows = await t.busy(ADMIN, [ANA]);
  assert.equal(rows.length, 2, 'Dentista e Almoço (o concluído não conta)');
  for (const r of rows) {
    assert.deepEqual(Object.keys(r).sort(), ['all_day', 'starts_at', 'user_ids']);
    assert.deepEqual(r.user_ids, [ANA]);
  }
  assert.doesNotMatch(JSON.stringify(rows), /Dentista|consulta|Almoço|restaurante/);
});

test('"Ocupado": quem já vê o compromisso não recebe a versão "ocupado"; usuário comum também recebe dos outros', async () => {
  const t = await setup();
  assert.equal((await t.busy(ANA, [ANA])).length, 0, 'o dono vê tudo');
  const bia = await t.busy(BIA, [ANA]);
  assert.equal(bia.length, 1, 'Bia vê o almoço (participante); só o dentista vem como ocupado');
  assert.equal((await t.busy(CAIO, [ANA, BIA])).length, 2);
  assert.equal((await t.busy(EVA, [ANA])).length, 0, 'outra empresa não enxerga');
  assert.equal((await t.busy(ADMIN, [])).length, 0);
});
