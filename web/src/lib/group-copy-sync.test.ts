// Cópias do mesmo grupo em números diferentes (0166): roda a migração num Postgres em memória (PGlite), com o
// rebuild_group_state de verdade (0043), e confere a cópia das mensagens e o recálculo da pendência.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const s43 = read('0043_conversation_closing.sql');
const REBUILD = s43.slice(s43.indexOf('create or replace function public.rebuild_group_state'), s43.indexOf('revoke all on function public.rebuild_group_state'));
const MIGRATION = read('0166_group_copy_sync.sql');

const CO = '00000000-0000-0000-0000-0000000000c1';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const AGENT = '00000000-0000-0000-0000-0000000000b1';
const CIVEL = '00000000-0000-0000-0000-00000000f001';
const TRAB = '00000000-0000-0000-0000-00000000f002';
const OTHER = '00000000-0000-0000-0000-00000000f003';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, role text);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create table public.groups (id uuid primary key, company_id uuid, instance_id uuid, jid text, name text,
      removed_at timestamptz, pending_since timestamptz, pending_message_id uuid, pending_count int default 0,
      last_message_at timestamptz, last_client_message_at timestamptz, last_team_message_at timestamptz,
      closed_at timestamptz, conversation_started_at timestamptz, last_message_preview text);
    create table public.messages (id uuid primary key default gen_random_uuid(), group_id uuid references public.groups(id),
      wa_message_id text not null, sender_jid text, sender_phone text, sender_name text, from_me boolean not null default false,
      from_team boolean not null default false, team_member_id uuid, message_type text not null default 'text', body text,
      sent_at timestamptz not null, response_time_seconds int, answered_message_id uuid, created_at timestamptz not null default now(),
      opens_pending boolean not null default true, ignored_as_last boolean not null default false, closes_conversation boolean not null default false,
      media_path text, media_mime text, media_size bigint, media_seconds int, media_status text,
      quoted_wa_id text, quoted_body text, quoted_sender_jid text, quoted_type text, forwarded boolean, contact_cards jsonb,
      edited_at timestamptz, original_body text, deleted_at timestamptz, anonymized_at timestamptz, hidden_at timestamptz,
      unique (group_id, wa_message_id));
  `);
  await db.exec(REBUILD);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  await db.exec(`
    insert into public.profiles values ('${ADMIN}', '${CO}', 'admin'), ('${AGENT}', '${CO}', 'agent');
    insert into public.groups (id, company_id, jid, name) values
      ('${CIVEL}', '${CO}', '123@g.us', 'FZP'), ('${TRAB}', '${CO}', '123@g.us', 'FZP'), ('${OTHER}', '${CO}', '999@g.us', 'Outro');
    -- as duas cópias receberam até 6 dias atrás; depois disso só a do Trabalhista
    insert into public.messages (group_id, wa_message_id, sender_name, from_team, body, sent_at) values
      ('${CIVEL}', 'A', 'Cliente', false, 'minuta pronta', now() - interval '6 days'),
      ('${TRAB}',  'A', 'Cliente', false, 'minuta pronta', now() - interval '6 days'),
      ('${TRAB}',  'B', 'Julia', true, 'vou verificar', now() - interval '5 days'),
      ('${TRAB}',  'C', 'Cliente', false, 'e então?', now() - interval '1 day');
    insert into public.messages (group_id, wa_message_id, sender_name, from_me, body, sent_at, media_path) values
      ('${TRAB}', 'D', 'Número Trabalhista', true, 'segue o arquivo', now() - interval '2 hours', 'c/x/d.pdf');
    insert into public.messages (group_id, wa_message_id, body, sent_at) values ('${OTHER}', 'Z', 'outro grupo', now());
  `);
  for (const g of [CIVEL, TRAB, OTHER]) await db.query('select public.rebuild_group_state($1)', [g]);
  // como no FZP: a pendência veio da mensagem ao vivo (o recálculo padrão descarta pendência de mais de 24 h)
  await db.exec(`update public.groups set pending_since = now() - interval '6 days', pending_count = 1 where id = '${CIVEL}'`);
  return db;
}

const state = async (db: PGlite, id: string) =>
  (await db.query<{ last_message_at: Date; pending_since: Date | null; n: number }>(
    `select g.last_message_at, g.pending_since, (select count(*)::int from public.messages m where m.group_id = g.id) n from public.groups g where g.id = $1`,
    [id],
  )).rows[0];

test('administrador sincroniza: a cópia parada recebe o que faltava e a pendência é recalculada', async () => {
  const db = await setup();
  const before = await state(db, CIVEL);
  assert.equal(before.n, 1);
  assert.ok(before.pending_since, 'parada há 6 dias com o cliente sem resposta');

  await db.exec(`select set_config('test.uid', '${ADMIN}', false)`);
  const r = (await db.query<{ r: { added: number } }>('select public.sync_group_copies($1, 30) r', [CIVEL])).rows[0].r;
  assert.equal(r.added, 3);
  const after = await state(db, CIVEL);
  assert.equal(after.n, 4);
  assert.ok(Date.now() - after.last_message_at.getTime() < 3 * 3600_000, 'última mensagem agora é a de 2 horas atrás');
  assert.equal(after.pending_since, null, 'a equipe respondeu por último: sem pendência');
  const d = (await db.query<{ from_me: boolean; from_team: boolean; media_path: string }>(
    `select from_me, from_team, media_path from public.messages where group_id = $1 and wa_message_id = 'D'`, [CIVEL])).rows[0];
  assert.deepEqual(d, { from_me: false, from_team: true, media_path: 'c/x/d.pdf' }, 'enviada pelo outro número entra como da equipe, com o arquivo');

  // de novo: nada a copiar, sem duplicar
  const again = (await db.query<{ r: { added: number } }>('select public.sync_group_copies($1, 30) r', [CIVEL])).rows[0].r;
  assert.equal(again.added, 0);
  assert.equal((await state(db, CIVEL)).n, 4);
});

test('worker: sincroniza todos os grupos com cópias, nos dois sentidos, sem mexer nos outros', async () => {
  const db = await setup();
  await db.exec(`insert into public.messages (group_id, wa_message_id, body, sent_at) values ('${CIVEL}', 'E', 'só o Cível recebeu', now() - interval '1 hour')`);
  await db.query('select public.rebuild_group_state($1)', [CIVEL]);
  const r = (await db.query<{ r: { added: number; groups: number } }>('select public.sync_all_group_copies(24 * 30) r')).rows[0].r;
  assert.deepEqual(r, { added: 4, groups: 2 });
  assert.equal((await state(db, CIVEL)).n, 5);
  assert.equal((await state(db, TRAB)).n, 5);
  assert.equal((await state(db, OTHER)).n, 1);
  const again = (await db.query<{ r: { added: number } }>('select public.sync_all_group_copies(6) r')).rows[0].r;
  assert.equal(again.added, 0);
});

test('janela de horas do worker: só o recente', async () => {
  const db = await setup();
  const r = (await db.query<{ r: { added: number } }>('select public.sync_all_group_copies(6) r')).rows[0].r;
  assert.equal(r.added, 1, 'só a mensagem de 2 horas atrás');
});

test('só administradores usam o botão', async () => {
  const db = await setup();
  await db.exec(`select set_config('test.uid', '${AGENT}', false)`);
  await assert.rejects(db.query('select public.sync_group_copies($1, 30)', [CIVEL]), /Só administradores/);
});
