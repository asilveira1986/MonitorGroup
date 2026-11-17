// Excluir conversa privada, só o administrador geral (0181). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0181_platform_delete_chats.sql', import.meta.url), 'utf8');
const CO1 = '00000000-0000-0000-0000-0000000000c1';
const CO2 = '00000000-0000-0000-0000-0000000000c2';
const PLATFORM = '00000000-0000-0000-0000-0000000000a1';
const ADMIN = '00000000-0000-0000-0000-0000000000a2';
const G1 = '00000000-0000-0000-0000-00000000d001';
const G2 = '00000000-0000-0000-0000-00000000d002';
const GOUT = '00000000-0000-0000-0000-00000000d003';
const C1 = '00000000-0000-0000-0000-00000000e001';
const COUT = '00000000-0000-0000-0000-00000000e002';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, role text, platform_admin boolean default false);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and platform_admin) $$;
    create table public.groups (id uuid primary key, company_id uuid, removed_at timestamptz);
    create table public.messages (id uuid primary key default gen_random_uuid(), group_id uuid references public.groups(id) on delete cascade);
    create table public.private_chats (id uuid primary key, company_id uuid);
    create table public.private_messages (id uuid primary key default gen_random_uuid(), chat_id uuid references public.private_chats(id) on delete cascade);
    insert into public.profiles values ('${PLATFORM}', '${CO1}', 'admin', true), ('${ADMIN}', '${CO1}', 'admin', false);
    insert into public.groups values ('${G1}', '${CO1}', null), ('${G2}', '${CO1}', now()), ('${GOUT}', '${CO2}', null);
    insert into public.messages (group_id) values ('${G1}'), ('${G1}'), ('${G2}'), ('${GOUT}');
    insert into public.private_chats values ('${C1}', '${CO1}'), ('${COUT}', '${CO2}');
    insert into public.private_messages (chat_id) values ('${C1}'), ('${COUT}');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  return { db, as };
}

test('conversa privada: só o administrador geral exclui, com as mensagens; a de outra empresa não', async () => {
  const { db, as } = await setup();
  await as(ADMIN);
  await assert.rejects(db.query(`select public.delete_private_chat('${C1}')`), /Só quem administra a plataforma/);
  await as(PLATFORM);
  await assert.rejects(db.query(`select public.delete_private_chat('${COUT}')`), /Conversa não encontrada/);
  await db.query(`select public.delete_private_chat('${C1}')`);
  assert.deepEqual((await db.query(`select id from public.private_chats`)).rows.length, 1);
  assert.equal((await db.query(`select 1 from public.private_messages`)).rows.length, 1);
});
