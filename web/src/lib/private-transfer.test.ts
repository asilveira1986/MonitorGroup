// Transferir a conversa privada para alguém de outro setor mantém o histórico numa conversa só (0186).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = (f: string) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const CIVEL = '00000000-0000-0000-0000-0000000000e1';
const TRAB = '00000000-0000-0000-0000-0000000000e2';
const S_CIVEL = '00000000-0000-0000-0000-0000000000f1';
const S_TRAB = '00000000-0000-0000-0000-0000000000f2';
const JULIA = '00000000-0000-0000-0000-0000000000a1'; // Cível
const FRAN = '00000000-0000-0000-0000-0000000000a2'; // Trabalhista
const ADMIN = '00000000-0000-0000-0000-0000000000a3';
const CH_CIVEL = '00000000-0000-0000-0000-00000000aa01';
const CH_TRAB = '00000000-0000-0000-0000-00000000aa02';

async function setup(withExisting: boolean) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.companies (id uuid primary key, private_chats_enabled boolean default true);
    create table public.whatsapp_instances (id uuid primary key, company_id uuid, name text, sector_id uuid, status text default 'connected', created_at timestamptz default now());
    create table public.profiles (id uuid primary key, company_id uuid, role text, active boolean default true, platform_admin boolean default false);
    create table public.sector_members (sector_id uuid, user_id uuid, primary key (sector_id, user_id));
    create table public.private_chats (id uuid primary key default gen_random_uuid(), instance_id uuid, company_id uuid, jid text, phone text, name text,
      last_message_at timestamptz, last_message_preview text, unread_count int not null default 0, created_at timestamptz not null default now(),
      tags uuid[] not null default '{}', assigned_to uuid, assigned_at timestamptz, closed_at timestamptz, closed_by uuid, released_from uuid, unique (instance_id, jid));
    create table public.private_messages (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, company_id uuid,
      wa_message_id text not null, from_me boolean default false, sender_name text, message_type text default 'text', body text, sent_at timestamptz not null, hidden_at timestamptz, unique (chat_id, wa_message_id));
    create table public.private_reactions (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, message_id uuid references public.private_messages(id) on delete cascade);
    create table public.private_outgoing (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, instance_id uuid, status text default 'pending');
    create table public.private_actions (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade);
    create table public.private_chat_events (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade, type text, from_user uuid, to_user uuid, note text);
    create function public.private_chat_visible(c uuid) returns boolean language sql stable as $$ select true $$;
    create function public.private_sees_all() returns boolean language sql stable as $$ select true $$;
    create function public.log_private_chat_event(c uuid, t text, f uuid, u uuid, n text) returns void language sql as $$ insert into public.private_chat_events (chat_id, type, from_user, to_user, note) values (c, t, f, u, n) $$;
    create function public.queue_push(a uuid, b text, c text, d text, e text, f text, g text, h uuid[], i text, j text) returns void language sql as $$ select 1 $$;
    create function public.user_display_name(u uuid) returns text language sql stable as $$ select 'Alguém' $$;
    insert into public.companies values ('${CO}', true);
    insert into public.whatsapp_instances (id, company_id, name, sector_id) values ('${CIVEL}', '${CO}', 'Cível', '${S_CIVEL}'), ('${TRAB}', '${CO}', 'Trabalhista', '${S_TRAB}');
    insert into public.profiles values ('${JULIA}', '${CO}', 'agent'), ('${FRAN}', '${CO}', 'agent'), ('${ADMIN}', '${CO}', 'admin');
    insert into public.sector_members values ('${S_CIVEL}', '${JULIA}'), ('${S_TRAB}', '${FRAN}');
    insert into public.private_chats (id, instance_id, company_id, jid, phone, name, assigned_to, last_message_at, last_message_preview) values
      ('${CH_CIVEL}', '${CIVEL}', '${CO}', '5555999786555@s.whatsapp.net', '5555999786555', 'Mitzi', '${JULIA}', '2026-11-18T10:00:00Z', 'resposta do cliente');
    insert into public.private_messages (chat_id, company_id, wa_message_id, sent_at, body, from_me) values
      ('${CH_CIVEL}', '${CO}', 'c1', '2026-11-18T09:00:00Z', 'Oi', false), ('${CH_CIVEL}', '${CO}', 'c2', '2026-11-18T10:00:00Z', 'Resposta do cliente', false);
    insert into public.private_outgoing (chat_id, instance_id) values ('${CH_CIVEL}', '${CIVEL}');
  `);
  if (withExisting) {
    await db.exec(`
      insert into public.private_chats (id, instance_id, company_id, jid, phone, name, last_message_at) values
        ('${CH_TRAB}', '${TRAB}', '${CO}', '555599786555@s.whatsapp.net', '555599786555', 'Mitzi (trabalhista)', '2026-11-10T10:00:00Z');
      insert into public.private_messages (chat_id, company_id, wa_message_id, sent_at, body, from_me) values
        ('${CH_TRAB}', '${CO}', 't1', '2026-11-10T10:00:00Z', 'Conversa antiga no trabalhista', true);
    `);
  }
  await db.exec(read('0179_private_chats_merge_by_phone.sql'));
  await db.exec(read('0186_transfer_keeps_history.sql'));
  await db.exec(read('0186_transfer_keeps_history.sql'));
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  return { db, as };
}

test('transferir para alguém de outro setor, sem conversa lá: a conversa passa para o número do setor com o histórico', async () => {
  const { db, as } = await setup(false);
  await as(JULIA);
  await db.query(`select public.assign_private_chat($1, $2, 'Cliente é do trabalhista')`, [CH_CIVEL, FRAN]);
  const chats = (await db.query<{ id: string; instance_id: string; assigned_to: string }>(`select id, instance_id, assigned_to from public.private_chats`)).rows;
  assert.equal(chats.length, 1, 'uma conversa só');
  assert.equal(chats[0].instance_id, TRAB, 'passa para o número do setor de quem recebeu');
  assert.equal(chats[0].assigned_to, FRAN);
  assert.equal((await db.query(`select 1 from public.private_messages where chat_id = $1`, [CH_CIVEL])).rows.length, 2, 'histórico mantido');
  assert.equal((await db.query<{ instance_id: string }>(`select instance_id from public.private_outgoing`)).rows[0].instance_id, TRAB, 'fila sai pelo número novo');
  const ev = (await db.query<{ type: string; note: string }>(`select type, note from public.private_chat_events`)).rows[0];
  assert.equal(ev.type, 'transferred');
  assert.match(ev.note, /Cliente é do trabalhista[\s\S]*número Trabalhista/);
});

test('transferir quando o contato já tem conversa no número do outro setor: as duas viram uma, com todo o histórico', async () => {
  const { db, as } = await setup(true);
  await as(JULIA);
  await db.query(`select public.assign_private_chat($1, $2, null)`, [CH_CIVEL, FRAN]);
  const chats = (await db.query<{ id: string; instance_id: string; assigned_to: string }>(`select id, instance_id, assigned_to from public.private_chats`)).rows;
  assert.equal(chats.length, 1);
  assert.equal(chats[0].id, CH_TRAB, 'fica a conversa que já existia no número do setor');
  assert.equal(chats[0].assigned_to, FRAN);
  const msgs = (await db.query<{ wa_message_id: string }>(`select wa_message_id from public.private_messages where chat_id = $1 order by sent_at`, [CH_TRAB])).rows.map((m) => m.wa_message_id);
  assert.deepEqual(msgs, ['t1', 'c1', 'c2'], 'mensagens das duas, em ordem');
});

test('administrador, ou mesmo setor: continua no mesmo número', async () => {
  const { db, as } = await setup(false);
  await as(JULIA);
  await db.query(`select public.assign_private_chat($1, $2, null)`, [CH_CIVEL, ADMIN]);
  assert.equal((await db.query<{ instance_id: string }>(`select instance_id from public.private_chats`)).rows[0].instance_id, CIVEL);
});
