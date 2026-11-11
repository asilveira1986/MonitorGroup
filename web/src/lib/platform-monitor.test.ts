// Acompanhamento liberado para administradores (0174): roda a função num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0174_monitor_for_admins.sql', import.meta.url), 'utf8');
const C1 = '00000000-0000-0000-0000-0000000000c1';
const C2 = '00000000-0000-0000-0000-0000000000c2';
const PLAT = '00000000-0000-0000-0000-0000000000a0'; // administrador da plataforma (empresa 1)
const ADM1 = '00000000-0000-0000-0000-0000000000a1';
const ANA = '00000000-0000-0000-0000-0000000000b1';
const ADM2 = '00000000-0000-0000-0000-0000000000a2';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table auth.users (id uuid primary key, last_sign_in_at timestamptz);
    create table public.companies (id uuid primary key, name text, active boolean default true, created_at timestamptz default now());
    create table public.profiles (id uuid primary key, company_id uuid, full_name text, email text, role text, active boolean default true,
      platform_admin boolean default false, last_seen_at timestamptz);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or platform_admin)) $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and platform_admin) $$;
    create table public.groups (id uuid primary key default gen_random_uuid(), company_id uuid, monitored boolean default true, removed_at timestamptz, pending_since timestamptz);
    create table public.messages (id uuid primary key default gen_random_uuid(), group_id uuid, sent_at timestamptz);
    create table public.private_messages (id uuid primary key default gen_random_uuid(), company_id uuid, sent_at timestamptz);
    create table public.private_chats (id uuid primary key default gen_random_uuid(), company_id uuid, assigned_to uuid, closed_at timestamptz, last_message_at timestamptz);
    create table public.whatsapp_instances (id uuid primary key default gen_random_uuid(), company_id uuid, name text, push_name text, phone text, status text, last_seen_at timestamptz);
    create table public.alerts (id uuid primary key default gen_random_uuid(), company_id uuid, status text);
    create table public.demands (id uuid primary key default gen_random_uuid(), company_id uuid, status text, promised_at timestamptz);
    create table public.activity_log (id bigserial primary key, company_id uuid, created_at timestamptz default now());
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  await db.exec(`
    insert into public.companies values ('${C1}', 'Flores'), ('${C2}', 'Outra');
    insert into public.profiles (id, company_id, full_name, email, role, platform_admin, last_seen_at) values
      ('${PLAT}', '${C1}', 'Plataforma', 'plat@x.com', 'admin', true, now()),
      ('${ADM1}', '${C1}', 'Ana Admin', 'ana@x.com', 'admin', false, now()),
      ('${ANA}', '${C1}', 'Bia', 'bia@x.com', 'agent', false, now() - interval '10 days'),
      ('${ADM2}', '${C2}', 'Eva', 'eva@x.com', 'admin', false, null);
    insert into public.whatsapp_instances (company_id, name, phone, status) values ('${C1}', 'Cível', '5551', 'connected'), ('${C2}', 'Outro', '5552', 'disconnected');
  `);
  const call = async (uid: string) => {
    await db.exec(`select set_config('test.uid', '${uid}', false)`);
    try {
      return { ok: true as const, rows: (await db.query<{ r: { name: string; users: number; people: { email: string }[]; numbers: number }[] }>(`select public.platform_monitor() r`)).rows[0].r };
    } catch (e) {
      return { ok: false as const, message: (e as Error).message };
    }
  };
  return call;
}

test('administrador da empresa vê só a própria empresa, sem os usuários da plataforma', async () => {
  const call = await setup();
  const r = await call(ADM1);
  assert.ok(r.ok);
  assert.deepEqual(r.rows.map((c) => c.name), ['Flores']);
  assert.deepEqual(r.rows[0].people.map((p) => p.email).sort(), ['ana@x.com', 'bia@x.com']);
  assert.equal(r.rows[0].users, 2);
  assert.equal(r.rows[0].numbers, 1, 'só os números dele');
});

test('administrador da plataforma continua vendo todas as empresas, com todos os usuários', async () => {
  const call = await setup();
  const r = await call(PLAT);
  assert.ok(r.ok);
  assert.deepEqual(r.rows.map((c) => c.name).sort(), ['Flores', 'Outra']);
  assert.equal(r.rows.find((c) => c.name === 'Flores')!.people.length, 3);
});

test('outra empresa não enxerga a primeira; atendente é barrado', async () => {
  const call = await setup();
  const eva = await call(ADM2);
  assert.ok(eva.ok);
  assert.deepEqual(eva.rows.map((c) => c.name), ['Outra']);
  const bia = await call(ANA);
  assert.equal(bia.ok, false);
  assert.match(bia.ok ? '' : bia.message, /Somente administradores/);
});
