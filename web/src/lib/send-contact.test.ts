// Enviar contato pela conversa (0182). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0182_send_contact.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const USER = '00000000-0000-0000-0000-0000000000a1';
const AGENT = '00000000-0000-0000-0000-0000000000a2';
const G = '00000000-0000-0000-0000-00000000d001';
const G_OFF = '00000000-0000-0000-0000-00000000d002';
const CHAT = '00000000-0000-0000-0000-00000000e001';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, role text, email text, full_name text);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_active_user() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid()) $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create function public.can_use_private_chats() returns boolean language sql stable as $$ select true $$;
    create table public.app_settings (company_id uuid primary key, reply_enabled boolean, reply_allowed text);
    create table public.groups (id uuid primary key, company_id uuid, instance_id uuid, removed_at timestamptz, monitored boolean default true);
    create table public.messages (id uuid primary key, group_id uuid);
    create table public.outgoing_messages (id uuid primary key default gen_random_uuid(), group_id uuid, instance_id uuid, body text, text_to_send text,
      quoted_message_id uuid, sender_name text, created_by uuid, message_type text, media_name text, status text default 'pending');
    create table public.private_chats (id uuid primary key, company_id uuid, instance_id uuid);
    create table public.private_outgoing (id uuid primary key default gen_random_uuid(), chat_id uuid, company_id uuid, instance_id uuid, body text, text_to_send text,
      created_by uuid, message_type text, media_name text, status text default 'pending');
    insert into public.profiles values ('${USER}', '${CO}', 'admin', 'u@x.com', 'Ana Silva'), ('${AGENT}', '${CO}', 'agent', 'a@x.com', 'Beto');
    insert into public.app_settings values ('${CO}', true, 'admin');
    insert into public.groups values ('${G}', '${CO}', gen_random_uuid(), null, true), ('${G_OFF}', '${CO}', gen_random_uuid(), null, false);
    insert into public.private_chats values ('${CHAT}', '${CO}', gen_random_uuid());
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  return { db, as };
}

test('vCard: nome limpo, telefone brasileiro com 55 e link do WhatsApp', async () => {
  const { db } = await setup();
  const v = (await db.query<{ v: string }>(`select public.contact_vcard('Maria; Souza,\nJr', '(51) 99999-8888') v`)).rows[0].v;
  assert.equal(v, 'BEGIN:VCARD\nVERSION:3.0\nN:;Maria Souza Jr;;;\nFN:Maria Souza Jr\nTEL;type=CELL;type=VOICE;waid=5551999998888:+5551999998888\nEND:VCARD');
  const w = (await db.query<{ v: string }>(`select public.contact_vcard('Ana', '+1 415 555 2671') v`)).rows[0].v;
  assert.match(w, /waid=14155552671:\+14155552671/);
});

test('grupo: enfileira o contato; valida nome, telefone, permissão e monitoramento', async () => {
  const { db, as } = await setup();
  await as(USER);
  const r = await db.query<{ message_type: string; body: string; text_to_send: string; status: string }>(`select * from public.send_group_contact($1, 'Maria Souza', '51 99999-8888')`, [G]);
  assert.equal(r.rows[0].message_type, 'contact');
  assert.equal(r.rows[0].body, 'Maria Souza');
  assert.match(r.rows[0].text_to_send, /BEGIN:VCARD[\s\S]*waid=5551999998888/);
  await assert.rejects(db.query(`select * from public.send_group_contact($1, '', '51 99999-8888')`, [G]), /nome do contato/);
  await assert.rejects(db.query(`select * from public.send_group_contact($1, 'Maria', '123')`, [G]), /telefone com DDD/);
  await assert.rejects(db.query(`select * from public.send_group_contact($1, 'Maria', '51 99999-8888')`, [G_OFF]), /monitoramento/);
  await as(AGENT);
  await assert.rejects(db.query(`select * from public.send_group_contact($1, 'Maria', '51 99999-8888')`, [G]), /Só administradores/);
});

test('privado: enfileira o contato na conversa da própria empresa', async () => {
  const { db, as } = await setup();
  await as(AGENT);
  const r = await db.query<{ message_type: string; body: string }>(`select * from public.send_private_contact($1, 'Maria Souza', '51 99999-8888')`, [CHAT]);
  assert.equal(r.rows[0].message_type, 'contact');
  assert.equal(r.rows[0].body, 'Maria Souza');
  await assert.rejects(db.query(`select * from public.send_private_contact(gen_random_uuid(), 'Maria', '51 99999-8888')`), /Conversa não encontrada/);
});
