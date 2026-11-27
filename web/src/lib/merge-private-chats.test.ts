// Limpeza das conversas privadas vazias que duplicam outra do mesmo contato (0197).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0197_merge_empty_duplicate_private_chats.sql', import.meta.url), 'utf8');
const PHONE_KEY = readFileSync(new URL('../../../supabase/migrations/0075_contacts_phone_match.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const A = '00000000-0000-0000-0000-0000000000a1';
const B = '00000000-0000-0000-0000-0000000000b1';
const LUIZA = '00000000-0000-0000-0000-00000000001a';
const FRAN = '00000000-0000-0000-0000-00000000001b';
const T1 = '00000000-0000-0000-0000-0000000000d1'; // etiquetas
const T2 = '00000000-0000-0000-0000-0000000000d2';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;

async function setup() {
  const db = new PGlite();
  const phoneKeyFn = PHONE_KEY.match(/create or replace function public\.phone_key[\s\S]*?\$\$;/)?.[0];
  assert.ok(phoneKeyFn);
  await db.exec(`
    create role authenticated; create role anon;
    ${phoneKeyFn}
    create table public.private_chats (id uuid primary key, company_id uuid, instance_id uuid, jid text, phone text, name text, tags uuid[] not null default '{}',
      assigned_to uuid, assigned_at timestamptz, closed_at timestamptz, last_message_at timestamptz, created_at timestamptz default now());
    create table public.private_messages (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade);
    create table public.private_outgoing (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, status text);
    create table public.private_chat_events (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, type text, created_at timestamptz default now());
    create table public.alerts (id uuid primary key default gen_random_uuid(), private_chat_id uuid references public.private_chats(id) on delete cascade);
  `);
  return db;
}

// a migration cria a função e já roda uma vez; `define` só cria (para ver o que a função devolve)
const run = (db: PGlite) => db.exec(MIGRATION);
const define = (db: PGlite) => db.exec(MIGRATION.replace('select * from public.cleanup_empty_duplicate_private_chats();', ''));
const chats = async (db: PGlite) => (await db.query<{ id: string; assigned_to: string | null; tags: string[] }>('select id, assigned_to, tags from public.private_chats order by id')).rows;

test('vazia + conversa do mesmo contato com mensagens: junta e apaga a vazia (histórico, alertas, etiquetas e transferência passam)', async () => {
  const db = await setup();
  await db.exec(`
    insert into public.private_chats (id, company_id, instance_id, jid, phone, name, tags, assigned_to, assigned_at, last_message_at) values
      ('${id(1)}', '${CO}', '${A}', '99@lid', '555198166317', 'civil flores', '{${T1}}', '${LUIZA}', now() - interval '1 day', now() - interval '5 hours');
    insert into public.private_messages (chat_id) values ('${id(1)}');
    insert into public.private_chats (id, company_id, instance_id, jid, phone, name, tags, assigned_to, assigned_at) values
      ('${id(2)}', '${CO}', '${B}', '555198166317@s.whatsapp.net', '5551998166317', 'civil flores', '{${T2}}', '${FRAN}', now());
    insert into public.private_chat_events (chat_id, type) values ('${id(2)}', 'transferred');
    insert into public.alerts (private_chat_id) values ('${id(2)}');
  `);
  await define(db);
  const out = await db.query<{ empty_chat_id: string; kept_chat_id: string; assignee_carried: boolean }>('select * from public.cleanup_empty_duplicate_private_chats()');
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].empty_chat_id, id(2));
  assert.equal(out.rows[0].kept_chat_id, id(1));
  assert.equal(out.rows[0].assignee_carried, true);
  const rows = await chats(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id(1));
  assert.equal(rows[0].assigned_to, FRAN, 'a transferência passou para a conversa mantida');
  assert.deepEqual([...rows[0].tags].sort(), [T1, T2].sort(), 'etiquetas juntas');
  assert.equal(Number((await db.query<{ n: string }>(`select count(*) as n from public.private_chat_events where chat_id = '${id(1)}'`)).rows[0].n), 1, 'histórico de atendimento passou');
  assert.equal(Number((await db.query<{ n: string }>(`select count(*) as n from public.alerts where private_chat_id = '${id(1)}'`)).rows[0].n), 1, 'alerta passou');
  // rodar de novo não acha mais nada
  assert.equal((await db.query('select * from public.cleanup_empty_duplicate_private_chats()')).rows.length, 0);
});

test('quem só abriu a conversa vazia (sem transferir) não muda o responsável da outra', async () => {
  const db = await setup();
  await db.exec(`
    insert into public.private_chats (id, company_id, instance_id, jid, phone, assigned_to, assigned_at, last_message_at) values
      ('${id(1)}', '${CO}', '${A}', 'a@s.whatsapp.net', '555198166317', '${LUIZA}', now() - interval '1 day', now());
    insert into public.private_messages (chat_id) values ('${id(1)}');
    insert into public.private_chats (id, company_id, instance_id, jid, phone, assigned_to, assigned_at) values
      ('${id(2)}', '${CO}', '${B}', 'b@s.whatsapp.net', '555198166317', '${FRAN}', now());
    insert into public.private_chat_events (chat_id, type) values ('${id(2)}', 'assigned');
  `);
  await run(db);
  const rows = await chats(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].assigned_to, LUIZA);
});

test('não apaga: vazia sem par com mensagens, vazia com envio pendente, nem conversa com mensagem', async () => {
  const db = await setup();
  await db.exec(`
    -- vazia sem par
    insert into public.private_chats (id, company_id, instance_id, jid, phone) values ('${id(1)}', '${CO}', '${A}', 'x', '555191110000');
    -- duas vazias do mesmo contato (nenhuma tem mensagens): ficam
    insert into public.private_chats (id, company_id, instance_id, jid, phone) values ('${id(2)}', '${CO}', '${A}', 'y', '555192220000'), ('${id(3)}', '${CO}', '${B}', 'z', '555192220000');
    -- vazia com envio pendente + par com mensagens
    insert into public.private_chats (id, company_id, instance_id, jid, phone, last_message_at) values ('${id(4)}', '${CO}', '${A}', 'm', '555193330000', now());
    insert into public.private_messages (chat_id) values ('${id(4)}');
    insert into public.private_chats (id, company_id, instance_id, jid, phone) values ('${id(5)}', '${CO}', '${B}', 'n', '555193330000');
    insert into public.private_outgoing (chat_id, status) values ('${id(5)}', 'pending');
    -- outra empresa com o mesmo telefone
    insert into public.private_chats (id, company_id, instance_id, jid, phone, last_message_at) values ('${id(6)}', '00000000-0000-0000-0000-0000000000c2', '${A}', 'o', '555194440000', now());
    insert into public.private_messages (chat_id) values ('${id(6)}');
    insert into public.private_chats (id, company_id, instance_id, jid, phone) values ('${id(7)}', '${CO}', '${A}', 'p', '555194440000');
  `);
  await run(db);
  assert.equal((await chats(db)).length, 7, 'nada apagado');
});

test('duas vazias do mesmo contato e uma com mensagens: junta as duas', async () => {
  const db = await setup();
  await db.exec(`
    insert into public.private_chats (id, company_id, instance_id, jid, phone, last_message_at) values ('${id(1)}', '${CO}', '${A}', 'a', '555195550000', now());
    insert into public.private_messages (chat_id) values ('${id(1)}');
    insert into public.private_chats (id, company_id, instance_id, jid, phone) values ('${id(2)}', '${CO}', '${A}', 'b', '5551995550000'), ('${id(3)}', '${CO}', '${B}', 'c', '555195550000');
  `);
  await run(db);
  const rows = await chats(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, id(1));
});
