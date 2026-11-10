// Alerta de agenda em tela (0170): roda a função do banco num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0170_my_agenda_reminders.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const ANA = '00000000-0000-0000-0000-0000000000b1';
const BIA = '00000000-0000-0000-0000-0000000000b2';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, active boolean default true);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_active_user() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and active) $$;
    create function public.my_team_member_ids() returns uuid[] language sql stable as $$ select '{}'::uuid[] $$;
    create table public.app_settings (company_id uuid, timezone text);
    create table public.agenda_events (id uuid primary key default gen_random_uuid(), company_id uuid, member_id uuid, title text,
      starts_at timestamptz, all_day boolean default false, done_at timestamptz, reminders int[] default '{15}', nature text);
    create table public.agenda_event_people (event_id uuid, user_id uuid, primary key (event_id, user_id));
    create function public.agenda_reminder_label(p_minutes int, p_all_day boolean default false) returns text language sql immutable as $$
      select case when p_all_day then 'hoje' when p_minutes = 0 then 'agora' else 'em ' || p_minutes || ' min' end $$;
    insert into public.profiles values ('${ANA}', '${CO}'), ('${BIA}', '${CO}');
    insert into public.app_settings values ('${CO}', 'America/Sao_Paulo');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const event = async (title: string, startsInMin: number, reminders: number[], people: string[], extra = '') => {
    const r = await db.query<{ id: string }>(
      `insert into public.agenda_events (company_id, title, starts_at, reminders${extra ? ', ' + extra.split('=')[0] : ''}) values ('${CO}', $1, now() + ($2 || ' minutes')::interval, $3::int[]${extra ? ', ' + extra.split('=')[1] : ''}) returning id`,
      [title, String(startsInMin), `{${reminders.join(',')}}`],
    );
    for (const u of people) await db.query(`insert into public.agenda_event_people values ($1, $2)`, [r.rows[0].id, u]);
    return r.rows[0].id;
  };
  const mine = async (uid: string) => {
    await db.exec(`select set_config('test.uid', '${uid}', false)`);
    return (await db.query<{ r: { title: string; minutes: number; label: string; event_id: string }[] }>(`select public.my_agenda_reminders() r`)).rows[0].r;
  };
  return { db, event, mine };
}

test('lembrete que acabou de tocar aparece para os participantes, com o texto do banco', async () => {
  const t = await setup();
  await t.event('Reunião', 14, [15], [ANA]); // 15 min antes tocou há 1 min
  const rows = await t.mine(ANA);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Reunião');
  assert.equal(rows[0].minutes, 15);
  assert.equal(rows[0].label, 'em 15 min');
  assert.deepEqual(await t.mine(BIA), [], 'quem não participa não recebe');
});

test('ainda não tocou, tocou há muito tempo e concluído: não aparecem', async () => {
  const t = await setup();
  await t.event('Daqui a pouco', 60, [15], [ANA]); // toca em 45 min
  await t.event('Antigo', 40, [15], [ANA]); // tocou há 25 min (passou da janela de 15)
  const done = await t.event('Feito', 10, [15], [ANA]);
  await t.db.query(`update public.agenda_events set done_at = now() where id = $1`, [done]);
  assert.deepEqual(await t.mine(ANA), []);
});

test('vários lembretes do mesmo compromisso: cada um no seu horário', async () => {
  const t = await setup();
  await t.event('Audiência', 5, [0, 5, 60], [ANA]); // o de 5 min tocou agora; o de 0 ainda não; o de 60 já passou da janela
  const rows = await t.mine(ANA);
  assert.deepEqual(rows.map((r) => r.minutes), [5]);
  await t.event('Na hora', 0, [0], [ANA]);
  assert.deepEqual((await t.mine(ANA)).map((r) => r.label).sort(), ['agora', 'em 5 min']);
});
