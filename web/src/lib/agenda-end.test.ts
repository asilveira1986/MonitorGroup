// Agenda: hora de término (0172). Roda 0168 e 0172 num Postgres em memória (PGlite), com um "miolo" simplificado no lugar
// do save_agenda_event de verdade (0102).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
    create table public.agenda_events (id uuid primary key default gen_random_uuid(), title text, starts_at timestamptz, all_day boolean default false,
      series_id uuid, company_id uuid, done_at timestamptz);
    -- só para a agenda_busy (0169/0172) ser criada: a função não é exercitada aqui
    create table public.agenda_event_people (event_id uuid, user_id uuid);
    create function public.is_active_user() returns boolean language sql as $$ select true $$;
    create function public.current_company_id() returns uuid language sql as $$ select null::uuid $$;
    create function public.can_see_agenda_event(p uuid) returns boolean language sql as $$ select true $$;
    create function public.save_agenda_event(p_id uuid, p_title text, p_notes text, p_starts_at timestamptz, p_all_day boolean, p_people uuid[],
      p_reminders int[] default null, p_type uuid default null, p_repeat jsonb default null, p_scope text default 'one')
    returns uuid language plpgsql as $$
    declare v uuid := p_id; s uuid; old timestamptz;
    begin
      if v is null then
        insert into public.agenda_events (title, starts_at, all_day) values (p_title, p_starts_at, coalesce(p_all_day, false)) returning id into v;
        if p_repeat is not null then
          s := gen_random_uuid();
          update public.agenda_events set series_id = s where id = v;
          insert into public.agenda_events (title, starts_at, all_day, series_id)
          values (p_title, p_starts_at + interval '1 day', coalesce(p_all_day, false), s), (p_title, p_starts_at + interval '2 days', coalesce(p_all_day, false), s);
        end if;
      else
        select starts_at into old from public.agenda_events where id = v;
        select series_id into s from public.agenda_events where id = v;
        update public.agenda_events set title = p_title, starts_at = p_starts_at where id = v;
        if p_scope = 'following' and s is not null then
          update public.agenda_events set starts_at = starts_at + (p_starts_at - old) where series_id = s and id <> v and starts_at > old;
        end if;
      end if;
      return v;
    end $$;
  `);
  await db.exec(read('0168_agenda_event_nature.sql'));
  await db.exec(read('0172_agenda_event_end.sql'));
  await db.exec(read('0172_agenda_event_end.sql'));
  await db.exec(read('0175_agenda_multi_day.sql'));
  await db.exec(read('0175_agenda_multi_day.sql'));
  const at = (h: number, m = 0) => `2026-11-12T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  const save = async (a: { id?: string | null; start?: string; end?: string | null; allDay?: boolean; repeat?: boolean; scope?: string }) => {
    try {
      const r = await db.query<{ id: string }>(
        `select public.save_agenda_event($1, 'Reunião', null, $2, $3, null, null, null, $4, $5, 'professional', $6) id`,
        [a.id ?? null, a.start ?? at(14), a.allDay ?? false, a.repeat ? JSON.stringify({ freq: 'daily' }) : null, a.scope ?? 'one', a.end ?? null],
      );
      return { ok: true as const, id: r.rows[0].id };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  };
  const rows = async () =>
    (await db.query<{ s: string; e: string | null }>(
      `select to_char(starts_at at time zone 'UTC', 'DD HH24:MI') s, to_char(ends_at at time zone 'UTC', 'DD HH24:MI') e from public.agenda_events order by starts_at`,
    )).rows;
  return { db, save, rows, at };
}

test('com término: grava; sem término: continua sem (compromissos de antes não mudam)', async () => {
  const t = await setup();
  assert.ok((await t.save({ start: t.at(14), end: t.at(15, 30) })).ok);
  assert.ok((await t.save({ start: t.at(10) })).ok);
  assert.deepEqual(await t.rows(), [
    { s: '12 10:00', e: null },
    { s: '12 14:00', e: '12 15:30' },
  ]);
});

test('término inválido: antes/igual ao início ou mais de 31 dias depois', async () => {
  const t = await setup();
  for (const end of [t.at(13), t.at(14)]) {
    const r = await t.save({ start: t.at(14), end });
    assert.equal(r.ok, false);
    assert.match(r.ok ? '' : r.message, /depois do início/);
  }
  const long = await t.save({ start: t.at(14), end: '2026-12-20T15:00:00Z' });
  assert.equal(long.ok, false);
  assert.match(long.ok ? '' : long.message, /até 31 dias/);
  assert.deepEqual(await t.rows(), []);
});

test('compromisso de vários dias: termina em outro dia, também em "dia todo"', async () => {
  const t = await setup();
  assert.ok((await t.save({ start: t.at(22), end: '2026-11-13T09:30:00Z' })).ok, 'vira a noite');
  assert.ok((await t.save({ start: t.at(12), end: '2026-11-15T12:00:00Z', allDay: true })).ok, 'dia todo de 12 a 15');
  assert.ok((await t.save({ start: t.at(8), end: '2026-12-10T08:00:00Z' })).ok, 'até 31 dias');
  const rows = (await t.rows()).map((r) => `${r.s}>${r.e}`);
  assert.deepEqual(rows.sort(), ['12 08:00>10 08:00', '12 12:00>15 12:00', '12 22:00>13 09:30']);
});

test('dia todo sem término continua de um dia só', async () => {
  const t = await setup();
  assert.ok((await t.save({ start: t.at(12), allDay: true })).ok);
  assert.deepEqual(await t.rows(), [{ s: '12 12:00', e: null }]);
});

test('repetição de compromisso de vários dias: cada ocorrência guarda a mesma duração', async () => {
  const t = await setup();
  assert.ok((await t.save({ start: t.at(12), end: '2026-11-14T12:00:00Z', allDay: true, repeat: true })).ok);
  assert.deepEqual(await t.rows(), [
    { s: '12 12:00', e: '14 12:00' },
    { s: '13 12:00', e: '15 12:00' },
    { s: '14 12:00', e: '16 12:00' },
  ]);
});

test('repetição: todas as ocorrências ficam com a mesma duração', async () => {
  const t = await setup();
  assert.ok((await t.save({ start: t.at(14), end: t.at(15), repeat: true })).ok);
  assert.deepEqual(await t.rows(), [
    { s: '12 14:00', e: '12 15:00' },
    { s: '13 14:00', e: '13 15:00' },
    { s: '14 14:00', e: '14 15:00' },
  ]);
});

test('edição: mudar o início leva o término; trocar o término e remover o término', async () => {
  const t = await setup();
  const made = await t.save({ start: t.at(14), end: t.at(15) });
  const id = made.ok ? made.id : '';
  assert.ok((await t.save({ id, start: t.at(16), end: t.at(17, 30) })).ok);
  assert.deepEqual(await t.rows(), [{ s: '12 16:00', e: '12 17:30' }]);
  assert.ok((await t.save({ id, start: t.at(16) })).ok);
  assert.deepEqual(await t.rows(), [{ s: '12 16:00', e: null }]);
});

test('"este e os próximos": início e duração valem para os próximos, o término acompanha', async () => {
  const t = await setup();
  const made = await t.save({ start: t.at(14), end: t.at(15), repeat: true });
  assert.ok((await t.save({ id: made.ok ? made.id : '', start: t.at(9), end: t.at(11), scope: 'following', repeat: true })).ok);
  assert.deepEqual(await t.rows(), [
    { s: '12 09:00', e: '12 11:00' },
    { s: '13 09:00', e: '13 11:00' },
    { s: '14 09:00', e: '14 11:00' },
  ]);
});

test('ocorrência gerada depois, fora do salvamento (worker), herda a duração da série', async () => {
  const t = await setup();
  await t.save({ start: t.at(14), end: t.at(15, 30), repeat: true });
  const series = (await t.db.query<{ series_id: string }>(`select series_id from public.agenda_events limit 1`)).rows[0].series_id;
  await t.db.query(`insert into public.agenda_events (title, starts_at, series_id) values ('Reunião', '2026-12-01T14:00:00Z', $1)`, [series]);
  assert.deepEqual((await t.rows()).pop(), { s: '01 14:00', e: '01 15:30' });
});
