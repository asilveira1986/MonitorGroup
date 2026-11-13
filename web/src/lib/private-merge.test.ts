// Conversas privadas: uma conversa por telefone (0179). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0179_private_chats_merge_by_phone.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const INST = '00000000-0000-0000-0000-0000000000e1';
const INST2 = '00000000-0000-0000-0000-0000000000e2';
const USER = '00000000-0000-0000-0000-0000000000a1';
const TAG = '00000000-0000-0000-0000-0000000000f1';

const SETUP = `
  create role authenticated; create role anon; create role service_role;
  create table public.companies (id uuid primary key, private_chats_enabled boolean default true);
  create table public.whatsapp_instances (id uuid primary key, company_id uuid);
  create table public.private_chats (
    id uuid primary key default gen_random_uuid(), instance_id uuid, company_id uuid, jid text, phone text, name text,
    last_message_at timestamptz, last_message_preview text, unread_count int not null default 0, created_at timestamptz not null default now(),
    tags uuid[] not null default '{}', assigned_to uuid, assigned_at timestamptz, closed_at timestamptz, closed_by uuid, unique (instance_id, jid));
  create table public.private_messages (
    id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, company_id uuid,
    wa_message_id text not null, from_me boolean default false, sender_name text, message_type text default 'text', body text,
    sent_at timestamptz not null, hidden_at timestamptz, unique (chat_id, wa_message_id));
  create table public.private_reactions (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, message_id uuid references public.private_messages(id) on delete cascade);
  create table public.private_outgoing (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade);
  create table public.private_actions (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade);
  create table public.private_chat_events (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade);
  insert into public.companies values ('${CO}', true);
  insert into public.whatsapp_instances values ('${INST}', '${CO}'), ('${INST2}', '${CO}');
`;

async function setup() {
  const db = new PGlite();
  await db.exec(SETUP);
  return db;
}
const ingest = (db: PGlite, jid: string, phone: string | null, wa: string, fromMe: boolean, at: string, inst = INST) =>
  db.query<{ r: { chat_id: string; inserted: boolean } }>(
    `select public.ingest_private_message($1, $2, $3, null, $4, $5, 'x', 'text', $6, $7, true) r`,
    [inst, jid, phone, wa, fromMe, `msg ${wa}`, at],
  );

test('private_phone_key: com e sem o 9 extra é a mesma pessoa', async () => {
  const db = new PGlite();
  await db.exec(SETUP);
  await db.exec(MIGRATION);
  const key = async (p: string | null) => (await db.query<{ k: string | null }>(`select public.private_phone_key($1) k`, [p])).rows[0].k;
  assert.equal(await key('+55 (51) 99978-6555'), await key('555199786555'));
  assert.equal(await key('555199786555'), '555199786555');
  assert.equal(await key('5551 3333-4444'), '555133334444');
  assert.equal(await key(null), null);
  assert.equal(await key(''), null);
});

test('recebimento: o mesmo telefone por outro identificador (LID) cai na mesma conversa', async () => {
  const db = await setup();
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const a = (await ingest(db, '555199786555@s.whatsapp.net', '555199786555', 'w1', true, '2026-11-13T14:26:00Z')).rows[0].r;
  const b = (await ingest(db, '123456789012345@lid', '5551999786555', 'w2', false, '2026-11-13T14:29:00Z')).rows[0].r;
  assert.equal(b.chat_id, a.chat_id, 'mesma conversa');
  assert.equal(b.inserted, true);
  // outro número conectado: conversa própria
  const c = (await ingest(db, '555199786555@s.whatsapp.net', '555199786555', 'w3', false, '2026-11-13T14:30:00Z', INST2)).rows[0].r;
  assert.notEqual(c.chat_id, a.chat_id);
  // sem telefone conhecido: continua por identificador
  const d = (await ingest(db, '999@lid', null, 'w4', false, '2026-11-13T14:31:00Z')).rows[0].r;
  assert.notEqual(d.chat_id, a.chat_id);
  assert.equal((await db.query(`select 1 from public.private_messages where chat_id = $1`, [a.chat_id])).rows.length, 2);
});

test('une as duplicadas que já existem: mensagens, não lidas, etiquetas, responsável e reabertura', async () => {
  const db = await setup();
  // duplicadas criadas antes da regra (o script antigo: uma conversa por identificador)
  await db.exec(`
    insert into public.private_chats (id, instance_id, company_id, jid, phone, name, unread_count, tags, closed_at, last_message_at, last_message_preview, created_at) values
      ('00000000-0000-0000-0000-00000000aa01', '${INST}', '${CO}', '555199786555@s.whatsapp.net', '555199786555', null, 0, '{}', now(), '2026-11-13T14:28:00Z', 'saída', now() - interval '2 days'),
      ('00000000-0000-0000-0000-00000000aa02', '${INST}', '${CO}', '123@lid', '5551999786555', 'Mitzi', 2, array['${TAG}']::uuid[], null, '2026-11-13T14:46:00Z', 'resposta', now() - interval '1 day'),
      ('00000000-0000-0000-0000-00000000aa03', '${INST2}', '${CO}', '555199786555@s.whatsapp.net', '555199786555', null, 0, '{}', null, null, null, now());
    update public.private_chats set assigned_to = '${USER}' where id = '00000000-0000-0000-0000-00000000aa02';
    insert into public.private_messages (chat_id, company_id, wa_message_id, sent_at, body) values
      ('00000000-0000-0000-0000-00000000aa01', '${CO}', 'm1', '2026-11-13T14:26:00Z', 'Boa tarde'),
      ('00000000-0000-0000-0000-00000000aa01', '${CO}', 'm2', '2026-11-13T14:27:00Z', 'Qual o período?'),
      ('00000000-0000-0000-0000-00000000aa01', '${CO}', 'm3', '2026-11-13T14:28:00Z', 'Data de início?'),
      ('00000000-0000-0000-0000-00000000aa02', '${CO}', 'm3', '2026-11-13T14:28:00Z', 'Data de início? (repetida)'),
      ('00000000-0000-0000-0000-00000000aa02', '${CO}', 'm4', '2026-11-13T14:29:00Z', 'Boa tarde eu já passei'),
      ('00000000-0000-0000-0000-00000000aa02', '${CO}', 'm5', '2026-11-13T14:46:00Z', 'Obrigada!');
    insert into public.private_outgoing (chat_id) values ('00000000-0000-0000-0000-00000000aa01');
    insert into public.private_chat_events (chat_id) values ('00000000-0000-0000-0000-00000000aa01');
  `);
  await db.exec(MIGRATION); // ao aplicar, já une
  const chats = (await db.query<{ id: string; unread_count: number; assigned_to: string | null; closed_at: string | null; tags: string[]; name: string | null; last_message_preview: string }>(
    `select * from public.private_chats where instance_id = '${INST}'`,
  )).rows;
  assert.equal(chats.length, 1, 'uma conversa só neste número');
  const c = chats[0];
  assert.equal(c.id, '00000000-0000-0000-0000-00000000aa02', 'fica a que tem responsável');
  assert.equal(c.unread_count, 2);
  assert.equal(c.assigned_to, USER);
  assert.equal(c.closed_at, null, 'uma das duas estava aberta: fica aberta');
  assert.deepEqual(c.tags, [TAG]);
  assert.equal(c.name, 'Mitzi');
  assert.equal(c.last_message_preview, 'Obrigada!');
  const msgs = (await db.query<{ wa_message_id: string }>(`select wa_message_id from public.private_messages where chat_id = $1 order by sent_at`, [c.id])).rows.map((m) => m.wa_message_id);
  assert.deepEqual(msgs, ['m1', 'm2', 'm3', 'm4', 'm5'], 'junta e não repete a mensagem que estava nas duas');
  assert.equal((await db.query(`select 1 from public.private_outgoing where chat_id = $1`, [c.id])).rows.length, 1);
  assert.equal((await db.query(`select 1 from public.private_chat_events where chat_id = $1`, [c.id])).rows.length, 1);
  // o outro número conectado não é mexido
  assert.equal((await db.query(`select 1 from public.private_chats where instance_id = '${INST2}'`)).rows.length, 1);
  // repetir o script não muda nada
  await db.exec(MIGRATION);
  assert.equal((await db.query(`select 1 from public.private_chats where instance_id = '${INST}'`)).rows.length, 1);
});
