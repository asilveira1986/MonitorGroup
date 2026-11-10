// Agenda: particular ou profissional, obrigatório (0168). Roda a migração num Postgres em memória (PGlite), com um
// "miolo" simplificado no lugar do save_agenda_event de verdade (0102), que ela renomeia e chama.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0168_agenda_event_nature.sql', import.meta.url), 'utf8');

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000a1'::uuid $$;
    create table public.agenda_events (id uuid primary key default gen_random_uuid(), title text, starts_at timestamptz,
      series_id uuid);
    -- miolo simplificado: cria o compromisso (ou muda o título); com repetição, cria 2 ocorrências a mais, na mesma série
    create function public.save_agenda_event(p_id uuid, p_title text, p_notes text, p_starts_at timestamptz, p_all_day boolean, p_people uuid[],
      p_reminders int[] default null, p_type uuid default null, p_repeat jsonb default null, p_scope text default 'one')
    returns uuid language plpgsql as $$
    declare v uuid := p_id; s uuid;
    begin
      if v is null then
        insert into public.agenda_events (title, starts_at) values (p_title, p_starts_at) returning id into v;
        if p_repeat is not null then
          s := gen_random_uuid();
          update public.agenda_events set series_id = s where id = v;
          insert into public.agenda_events (title, starts_at, series_id) values (p_title, p_starts_at + interval '1 day', s), (p_title, p_starts_at + interval '2 days', s);
        end if;
      else
        update public.agenda_events set title = p_title where id = v;
      end if;
      return v;
    end $$;
    insert into public.agenda_events (title, starts_at) values ('antigo', now());
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // pode rodar de novo
  const save = async (args: { id?: string | null; nature?: string | null; repeat?: boolean; scope?: string }) => {
    try {
      const r = await db.query<{ id: string }>(
        `select public.save_agenda_event($1, 'Reunião', null, now() + interval '7 days', false, null, null, null, $2, $3, $4) id`,
        [args.id ?? null, args.repeat ? JSON.stringify({ freq: 'daily' }) : null, args.scope ?? 'one', args.nature ?? null],
      );
      return { ok: true as const, id: r.rows[0].id };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  };
  const natures = async () => (await db.query<{ title: string; nature: string }>(`select title, nature from public.agenda_events order by starts_at`)).rows;
  return { db, save, natures };
}

test('compromissos que já existiam ficam como profissionais', async () => {
  const t = await setup();
  assert.deepEqual(await t.natures(), [{ title: 'antigo', nature: 'professional' }]);
});

test('novo compromisso: a natureza é obrigatória e só aceita particular ou profissional', async () => {
  const t = await setup();
  const none = await t.save({});
  assert.equal(none.ok, false);
  assert.match(none.ok ? '' : none.message, /particular ou profissional/);
  const bad = await t.save({ nature: 'secreto' });
  assert.equal(bad.ok, false);
  const ok = await t.save({ nature: 'personal' });
  assert.ok(ok.ok);
  assert.equal((await t.natures()).filter((n) => n.title === 'Reunião')[0].nature, 'personal');
});

test('repetição: todas as ocorrências nascem com a natureza escolhida', async () => {
  const t = await setup();
  assert.ok((await t.save({ nature: 'personal', repeat: true })).ok);
  const rows = (await t.natures()).filter((n) => n.title === 'Reunião');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.nature === 'personal'));
});

test('edição: sem natureza mantém; com natureza troca; "este e os próximos" troca a série a partir dele', async () => {
  const t = await setup();
  const created = await t.save({ nature: 'professional', repeat: true });
  assert.ok(created.ok);
  const first = created.ok ? created.id : '';
  assert.ok((await t.save({ id: first })).ok);
  assert.ok((await t.natures()).filter((n) => n.title === 'Reunião').every((n) => n.nature === 'professional'));
  // só este
  assert.ok((await t.save({ id: first, nature: 'personal', scope: 'one' })).ok);
  assert.deepEqual((await t.natures()).filter((n) => n.title === 'Reunião').map((n) => n.nature), ['personal', 'professional', 'professional']);
  // este e os próximos
  assert.ok((await t.save({ id: first, nature: 'personal', scope: 'following' })).ok);
  assert.ok((await t.natures()).filter((n) => n.title === 'Reunião').every((n) => n.nature === 'personal'));
});

test('ocorrência gerada depois, pela série, herda a natureza do compromisso', async () => {
  const t = await setup();
  const created = await t.save({ nature: 'personal', repeat: true });
  assert.ok(created.ok);
  const series = (await t.db.query<{ series_id: string }>(`select series_id from public.agenda_events where id = $1`, [created.ok ? created.id : ''])).rows[0].series_id;
  // geração tardia (como a do worker): insert sem natureza, fora do salvamento
  await t.db.query(`insert into public.agenda_events (title, starts_at, series_id) values ('Reunião', now() + interval '30 days', $1)`, [series]);
  const last = (await t.natures()).filter((n) => n.title === 'Reunião').pop();
  assert.equal(last?.nature, 'personal');
});
