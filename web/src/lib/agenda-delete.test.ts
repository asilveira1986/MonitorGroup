// Agenda: só quem criou o compromisso pode excluí-lo (0176). Roda as migrações num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const ANA = '00000000-0000-0000-0000-0000000000b1';
const BIA = '00000000-0000-0000-0000-0000000000b2';
const EV = '00000000-0000-0000-0000-00000000d001';
const EV2 = '00000000-0000-0000-0000-00000000d002';

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
      notes text, starts_at timestamptz, all_day boolean default false, done_at timestamptz, nature text, series_id uuid);
    create table public.agenda_event_people (event_id uuid, user_id uuid, company_id uuid, primary key (event_id, user_id));
  `);
  await db.exec(read('0169_agenda_personal_busy.sql'));
  await db.exec(read('0176_agenda_delete_creator_only.sql'));
  await db.exec(read('0176_agenda_delete_creator_only.sql'));
  await db.exec(`
    insert into public.profiles values ('${ADMIN}', '${CO}', 'admin'), ('${ANA}', '${CO}', 'agent'), ('${BIA}', '${CO}', 'agent');
    insert into public.agenda_events (id, company_id, owner_id, created_by, title, starts_at, nature) values
      ('${EV}', '${CO}', '${ANA}', '${ANA}', 'Reunião', now() + interval '1 day', 'professional'),
      ('${EV2}', '${CO}', null, '${ANA}', 'Antigo sem dono', now() + interval '2 days', 'professional');
    insert into public.agenda_event_people values ('${EV}', '${ANA}', '${CO}'), ('${EV}', '${BIA}', '${CO}'), ('${EV2}', '${ANA}', '${CO}');
  `);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  return { db, as };
}

test('só quem criou pode excluir; administrador e participante editam mas não excluem', async () => {
  const { db, as } = await setup();
  const can = async (uid: string, id: string, fn: string) => {
    await as(uid);
    return (await db.query<{ r: boolean }>(`select public.${fn}($1) r`, [id])).rows[0].r;
  };
  assert.equal(await can(ANA, EV, 'can_delete_agenda_event'), true);
  assert.equal(await can(ADMIN, EV, 'can_edit_agenda_event'), true);
  assert.equal(await can(ADMIN, EV, 'can_delete_agenda_event'), false);
  assert.equal(await can(BIA, EV, 'can_edit_agenda_event'), true);
  assert.equal(await can(BIA, EV, 'can_delete_agenda_event'), false);
  // compromisso antigo sem dono: vale quem criou
  assert.equal(await can(ANA, EV2, 'can_delete_agenda_event'), true);
});

test('delete_agenda_event recusa quem não criou e exclui para quem criou', async () => {
  const { db, as } = await setup();
  await as(ADMIN);
  await assert.rejects(db.query(`select public.delete_agenda_event($1, 'one')`, [EV]), /Só quem criou/);
  await as(BIA);
  await assert.rejects(db.query(`select public.delete_agenda_event($1, 'one')`, [EV]), /Só quem criou/);
  assert.equal((await db.query(`select 1 from public.agenda_events where id = $1`, [EV])).rows.length, 1);
  await as(ANA);
  await db.query(`select public.delete_agenda_event($1, 'one')`, [EV]);
  assert.equal((await db.query(`select 1 from public.agenda_events where id = $1`, [EV])).rows.length, 0);
});
