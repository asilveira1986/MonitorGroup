// Recuperação de mensagens antigas das conversas privadas, só do administrador geral (0178). Roda a migração no PGlite.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0178_private_history_recovery.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const PLATFORM = '00000000-0000-0000-0000-0000000000a1';
const ADMIN = '00000000-0000-0000-0000-0000000000a2';
const CHAT = '00000000-0000-0000-0000-00000000c001';
const GROUP = '00000000-0000-0000-0000-00000000d001';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.companies (id uuid primary key);
    create table public.profiles (id uuid primary key, company_id uuid, role text, platform_admin boolean default false, active boolean default true);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and active and platform_admin) $$;
    create table public.private_chats (id uuid primary key, company_id uuid, jid text);
    create table public.groups (id uuid primary key, company_id uuid, removed_at timestamptz);
    -- grupos (0161), versão anterior: administrador comum podia pedir
    create table public.history_requests (id uuid primary key default gen_random_uuid(), company_id uuid, group_id uuid, requested_by uuid default auth.uid(),
      days int, since timestamptz, status text default 'pending', note text, finished_at timestamptz, updated_at timestamptz default now());
    create function public.request_history_recovery(p_group_id uuid, p_days int) returns public.history_requests language plpgsql security definer as $$
      declare r public.history_requests; begin if not public.is_admin() then raise exception 'antigo'; end if;
      insert into public.history_requests (company_id, group_id, days, since) values (public.current_company_id(), p_group_id, p_days, now()) returning * into r; return r; end $$;
    insert into public.companies values ('${CO}');
    insert into public.profiles values ('${PLATFORM}', '${CO}', 'admin', true), ('${ADMIN}', '${CO}', 'admin', false);
    insert into public.private_chats values ('${CHAT}', '${CO}', '5551@s.whatsapp.net');
    insert into public.groups values ('${GROUP}', '${CO}', null);
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  return { db, as };
}

test('conversa privada: só o administrador geral pede e cancela; um pedido aberto por conversa', async () => {
  const { db, as } = await setup();
  await as(ADMIN);
  await assert.rejects(db.query(`select * from public.request_private_history_recovery($1, 7)`, [CHAT]), /Só quem administra a plataforma/);
  await as(PLATFORM);
  await assert.rejects(db.query(`select * from public.request_private_history_recovery($1, 31)`, [CHAT]), /1 a 30 dias/);
  const ok = await db.query<{ status: string; days: number }>(`select * from public.request_private_history_recovery($1, 7)`, [CHAT]);
  assert.equal(ok.rows[0].status, 'pending');
  assert.equal(ok.rows[0].days, 7);
  await assert.rejects(db.query(`select * from public.request_private_history_recovery($1, 7)`, [CHAT]), /já existe|Já existe/i);
  await as(ADMIN);
  await db.query(`select public.cancel_private_history_recovery((select id from public.private_history_requests limit 1))`).catch(() => {});
  assert.equal((await db.query<{ status: string }>(`select status from public.private_history_requests`)).rows[0].status, 'pending', 'administrador comum não cancela');
  await as(PLATFORM);
  await db.query(`select public.cancel_private_history_recovery((select id from public.private_history_requests limit 1))`);
  assert.equal((await db.query<{ status: string }>(`select status from public.private_history_requests`)).rows[0].status, 'cancelled');
});

test('grupos (0161): o pedido passa a ser só do administrador geral', async () => {
  const { db, as } = await setup();
  await as(ADMIN);
  await assert.rejects(db.query(`select * from public.request_history_recovery($1, 7)`, [GROUP]), /Só quem administra a plataforma/);
  await as(PLATFORM);
  const r = await db.query<{ status: string }>(`select * from public.request_history_recovery($1, 7)`, [GROUP]);
  assert.equal(r.rows[0].status, 'pending');
});
