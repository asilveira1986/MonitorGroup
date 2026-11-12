// Pesquisa de mensagens (0177). Roda a migração num Postgres em memória (PGlite), com e sem as extensões.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0177_message_search.sql', import.meta.url), 'utf8');
const G1 = '00000000-0000-0000-0000-0000000000a1';
const G2 = '00000000-0000-0000-0000-0000000000a2';
const C1 = '00000000-0000-0000-0000-0000000000c1';

async function setup(withExtensions: boolean) {
  const db = new PGlite(withExtensions ? { extensions: { unaccent, pg_trgm } } : {});
  await db.exec(`
    create role authenticated; create role anon;
    create function public.is_technical_message_type(t text) returns boolean language sql immutable as $$ select t in ('reaction','protocol') $$;
    create table public.groups (id uuid primary key, name text);
    create table public.messages (id uuid primary key default gen_random_uuid(), group_id uuid, sender_name text, from_me boolean default false,
      message_type text default 'text', body text, sent_at timestamptz, deleted_at timestamptz, hidden_at timestamptz, anonymized_at timestamptz);
    create table public.private_chats (id uuid primary key, name text, phone text);
    create table public.private_messages (id uuid primary key default gen_random_uuid(), chat_id uuid, from_me boolean default false,
      message_type text default 'text', body text, sent_at timestamptz, deleted_at timestamptz, hidden_at timestamptz, anonymized_at timestamptz);
    alter table public.messages enable row level security;
    create policy see on public.messages for select to authenticated using (group_id::text = any(string_to_array(current_setting('test.groups', true), ',')));
    grant select on all tables in schema public to authenticated;
    insert into public.groups values ('${G1}', 'Jurídico'), ('${G2}', 'Outro grupo');
    insert into public.messages (group_id, sender_name, body, sent_at, message_type, deleted_at, hidden_at) values
      ('${G1}', 'Ana', 'Audiência marcada para sexta', '2026-11-01', 'text', null, null),
      ('${G1}', 'Bia', 'audiencia remarcada', '2026-11-02', 'text', null, null),
      ('${G1}', 'Cris', 'AUDIÊNCIA cancelada', '2026-11-03', 'text', now(), null),
      ('${G1}', 'Dani', 'audiência oculta', '2026-11-04', 'text', null, now()),
      ('${G1}', 'Edu', 'desconto de 50% no boleto', '2026-11-05', 'text', null, null),
      ('${G1}', 'Edu', 'valor 5000 reais', '2026-11-06', 'text', null, null),
      ('${G1}', 'Edu', 'audiência', '2026-11-07', 'reaction', null, null),
      ('${G2}', 'Fe', 'audiência do outro grupo', '2026-11-08', 'text', null, null);
    insert into public.private_chats values ('${C1}', 'Julia', '5551');
    insert into public.private_messages (chat_id, body, sent_at) values ('${C1}', 'Obrigada pela atenção', '2026-11-01'), ('${C1}', 'obrigada!', '2026-11-02');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // pode ser repetida
  return db;
}
const bodies = (r: { rows: { body: string }[] }) => r.rows.map((x) => x.body);

for (const withExt of [true, false]) {
  test(`pesquisa de mensagens ${withExt ? 'com unaccent/pg_trgm' : 'sem as extensões'}`, async () => {
    const db = await setup(withExt);
    await db.exec(`set role authenticated; select set_config('test.groups', '${G1}', false)`);
    const r = await db.query<{ body: string }>(`select body from public.search_group_messages('audiência', null, 50)`);
    // sem acento e sem maiúsculas; some apagada, oculta, técnica e de grupo que a pessoa não vê
    assert.deepEqual(bodies(r), withExt ? ['audiencia remarcada', 'Audiência marcada para sexta'] : ['Audiência marcada para sexta']);
    const nothing = await db.query(`select 1 from public.search_group_messages('x', null, 50)`);
    assert.equal(nothing.rows.length, 0, 'menos de 2 letras não pesquisa');
    // % e _ valem como letras comuns
    assert.deepEqual(bodies(await db.query(`select body from public.search_group_messages('50%', null, 50)`)), ['desconto de 50% no boleto']);
    assert.deepEqual(bodies(await db.query(`select body from public.search_group_messages('5%0', null, 50)`)), []);
    assert.deepEqual(bodies(await db.query(`select body from public.search_group_messages('5_00', null, 50)`)), []);
    // dentro de um grupo só
    assert.equal((await db.query(`select 1 from public.search_group_messages('audiência', '${G2}', 50)`)).rows.length, 0, 'grupo que não vê');
    const lim = await db.query(`select 1 from public.search_group_messages('au', null, 1)`);
    assert.equal(lim.rows.length, 1);
    const p = await db.query<{ body: string }>(`select body from public.search_private_messages('OBRIGADA', null, 50)`);
    assert.deepEqual(bodies(p), ['obrigada!', 'Obrigada pela atenção']);
  });
}

test('findMatches: sem diferenciar maiúsculas e acentos, com os índices do texto original', async () => {
  const { findMatches, snippet } = await import('./message-search.ts');
  assert.deepEqual(findMatches('Audiência e audiencia', 'AUDIENCIA'), [{ start: 0, end: 9 }, { start: 12, end: 21 }]);
  assert.deepEqual(findMatches('não é ação', 'acao'), [{ start: 6, end: 10 }]);
  assert.deepEqual(findMatches('aaaa', 'aa'), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(findMatches('abc', ''), []);
  assert.deepEqual(findMatches('abc', 'x'), []);
  const s = snippet('Bom dia, tudo bem? A audiência de amanhã foi remarcada para as 14h na sala 2 do fórum central.', 'AUDIENCIA', 10);
  assert.equal(s.match, 'audiência');
  assert.ok(s.before.startsWith('…') && s.after.endsWith('…'));
});
