// "Nova conversa" (0196): reaproveita a conversa que a pessoa já tem, em vez de abrir uma vazia.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0196_start_private_chat_reuse.sql', import.meta.url), 'utf8');
const PHONE_KEY = readFileSync(new URL('../../../supabase/migrations/0075_contacts_phone_match.sql', import.meta.url), 'utf8');
const COMPANY = '00000000-0000-0000-0000-0000000000c1';
const ME = '00000000-0000-0000-0000-00000000000e';
const INST_A = '00000000-0000-0000-0000-0000000000a1'; // número do usuário
const INST_B = '00000000-0000-0000-0000-0000000000b1'; // outro número da empresa

async function setup() {
  const db = new PGlite();
  const phoneKeyFn = PHONE_KEY.match(/create or replace function public\.phone_key[\s\S]*?\$\$;/)?.[0];
  assert.ok(phoneKeyFn, 'phone_key da 0075');
  await db.exec(`
    create role authenticated; create role anon;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${ME}'::uuid $$;
    ${phoneKeyFn}
    create table public.whatsapp_instances (id uuid primary key, company_id uuid, sector_id uuid, status text default 'connected', created_at timestamptz default now());
    create table public.sector_members (sector_id uuid, user_id uuid);
    create table public.wa_contacts (instance_id uuid, jid text, phone text, name text, notify text);
    create table public.private_chats (id uuid primary key default gen_random_uuid(), instance_id uuid not null, company_id uuid, jid text not null, phone text, name text,
      assigned_to uuid, assigned_at timestamptz, closed_at timestamptz, last_message_at timestamptz, created_at timestamptz default now(), unique (instance_id, jid));
    create function public.current_company_id() returns uuid language sql as $$ select '${COMPANY}'::uuid $$;
    create function public.can_use_private_chats() returns boolean language sql as $$ select true $$;
    create function public.private_sees_all() returns boolean language sql as $$ select false $$;
    create function public.user_display_name(u uuid) returns text language sql as $$ select 'outra pessoa' $$;
    insert into public.whatsapp_instances (id, company_id, created_at) values ('${INST_A}', '${COMPANY}', now() - interval '2 days'), ('${INST_B}', '${COMPANY}', now());
  `);
  await db.exec(MIGRATION);
  return db;
}

const start = async (db: PGlite, args: { jid?: string; phone?: string; name?: string }) =>
  (await db.query<{ id: string; instance_id: string; jid: string; assigned_to: string }>('select * from public.start_private_chat($1, $2, $3)', [args.jid ?? null, args.phone ?? null, args.name ?? null])).rows[0];
const count = async (db: PGlite) => Number((await db.query<{ n: string }>('select count(*) as n from public.private_chats')).rows[0].n);

test('histórico sob o identificador @lid, no mesmo número: abre essa conversa, não uma vazia', async () => {
  const db = await setup();
  await db.exec(`insert into public.private_chats (id, instance_id, company_id, jid, phone, name, last_message_at) values
    ('00000000-0000-0000-0000-000000000001', '${INST_A}', '${COMPANY}', '123456@lid', '555198166317', 'civil flores', now())`);
  // digitado com o telefone, sem o 9 do celular
  const chat = await start(db, { phone: '(51) 9816-6317' });
  assert.equal(chat.id, '00000000-0000-0000-0000-000000000001');
  assert.equal(await count(db), 1, 'não criou outra conversa');
  assert.equal(chat.assigned_to, ME, 'quem inicia fica com ela');
});

test('histórico em outro número conectado: abre essa conversa (o histórico fica onde está)', async () => {
  const db = await setup();
  await db.exec(`insert into public.private_chats (id, instance_id, company_id, jid, phone, name, last_message_at) values
    ('00000000-0000-0000-0000-000000000002', '${INST_B}', '${COMPANY}', '555198166317@s.whatsapp.net', '555198166317', 'civil flores', now())`);
  const chat = await start(db, { phone: '51998166317' }); // com o 9
  assert.equal(chat.id, '00000000-0000-0000-0000-000000000002');
  assert.equal(await count(db), 1);
});

test('conversa vazia de outro número não conta: começa uma nova no número do usuário', async () => {
  const db = await setup();
  await db.exec(`insert into public.private_chats (instance_id, company_id, jid, phone, name) values
    ('${INST_B}', '${COMPANY}', '555198166317@s.whatsapp.net', '555198166317', 'civil flores')`);
  const chat = await start(db, { phone: '5551998166317' });
  assert.equal(chat.instance_id, INST_A);
  assert.equal(await count(db), 2);
});

test('pessoa sem conversa: cria uma nova; repetir reaproveita a mesma', async () => {
  const db = await setup();
  const first = await start(db, { phone: '5551977776666', name: 'Novo' });
  assert.equal(first.jid, '5551977776666@s.whatsapp.net');
  const again = await start(db, { phone: '51 97777-6666' });
  assert.equal(again.id, first.id);
  assert.equal(await count(db), 1);
});

test('conversa de outro usuário: continua exigindo a transferência', async () => {
  const db = await setup();
  await db.exec(`insert into public.private_chats (instance_id, company_id, jid, phone, assigned_to, last_message_at) values
    ('${INST_A}', '${COMPANY}', '555198166317@s.whatsapp.net', '555198166317', '00000000-0000-0000-0000-0000000000ff', now())`);
  await assert.rejects(() => start(db, { phone: '5551998166317' }), /Esta conversa está com/);
});
