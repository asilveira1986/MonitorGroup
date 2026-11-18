// Ignorar mensagens antigas nas pendências (0187). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0187_pending_ignore_before.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const AGENT = '00000000-0000-0000-0000-0000000000a2';
const G_OLD = '00000000-0000-0000-0000-00000000d001'; // pendente só por mensagem antiga
const G_NEW = '00000000-0000-0000-0000-00000000d002'; // pendente por mensagem nova

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, role text);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create table public.app_settings (company_id uuid primary key, timezone text, updated_at timestamptz);
    create table public.groups (id uuid primary key, company_id uuid, pending_since timestamptz, followup_status text, followup_updated_at timestamptz);
    create table public.messages (id uuid primary key default gen_random_uuid(), group_id uuid, from_team boolean default false, opens_pending boolean default true, sent_at timestamptz, body text);
    create table public.private_messages (id uuid primary key default gen_random_uuid(), company_id uuid, from_me boolean default false, opens_pending boolean default true, sent_at timestamptz);
    create table public.rebuilt (group_id uuid, live_since timestamptz);
    -- recalcula a pendência do grupo só pelas mensagens que ainda pedem resposta
    create function public.rebuild_group_state(g uuid, live timestamptz default now()) returns void language plpgsql as $$
    begin
      insert into public.rebuilt values (g, live);
      update public.groups set pending_since = (select min(sent_at) from public.messages where group_id = g and not from_team and opens_pending) where id = g;
    end $$;
    insert into public.profiles values ('${ADMIN}', '${CO}', 'admin'), ('${AGENT}', '${CO}', 'agent');
    insert into public.app_settings values ('${CO}', 'America/Sao_Paulo', now());
    insert into public.groups values ('${G_OLD}', '${CO}', '2026-11-10T12:00:00Z', 'company', now()), ('${G_NEW}', '${CO}', '2026-11-10T12:00:00Z', 'company', now());
    insert into public.messages (group_id, sent_at, body) values
      ('${G_OLD}', '2026-11-10T12:00:00Z', 'antiga'), ('${G_NEW}', '2026-11-10T12:00:00Z', 'antiga'), ('${G_NEW}', '2026-11-17T12:00:00Z', 'nova');
    insert into public.private_messages (company_id, sent_at) values ('${CO}', '2026-11-10T12:00:00Z'), ('${CO}', '2026-11-18T12:00:00Z');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  return { db, as };
}

test('ao aplicar: 17/11 vira a data de corte; o que veio antes deixa de pedir resposta e os grupos são recalculados', async () => {
  const { db } = await setup();
  const cfg = (await db.query<{ d: string }>(`select to_char(pending_ignore_before at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') as d from public.app_settings`)).rows[0];
  assert.equal(cfg.d, '2026-11-17 00:00');
  const open = (await db.query<{ body: string; opens_pending: boolean }>(`select body, opens_pending from public.messages order by sent_at`)).rows;
  assert.deepEqual(open.map((m) => [m.body, m.opens_pending]), [['antiga', false], ['antiga', false], ['nova', true]]);
  const old = (await db.query<{ pending_since: string | null }>(`select to_char(pending_since at time zone 'UTC', 'YYYY-MM-DD') as pending_since from public.groups where id = '${G_OLD}'`)).rows[0];
  assert.equal(old.pending_since, null, 'só tinha mensagem antiga: deixa de aguardar');
  const nw = (await db.query<{ pending_since: string | null }>(`select to_char(pending_since at time zone 'UTC', 'YYYY-MM-DD') as pending_since from public.groups where id = '${G_NEW}'`)).rows[0];
  assert.equal(nw.pending_since, '2026-11-17', 'a mensagem nova continua pendente');
  assert.equal((await db.query(`select 1 from public.private_messages where opens_pending`)).rows.length, 1, 'privadas: só a nova');
  assert.equal((await db.query(`select 1 from public.groups where followup_updated_at is null`)).rows.length, 2, 'o worker refaz a pendência da conversa');
  // recálculo sem a data de corte de 24 h do histórico
  assert.equal((await db.query(`select 1 from public.rebuilt where live_since = 'epoch'`)).rows.length >= 1, true);
});

test('administrador muda a data; atendente não; vazio volta a contar tudo (sem desfazer o que foi marcado)', async () => {
  const { db, as } = await setup();
  await as(AGENT);
  await assert.rejects(db.query(`select public.set_pending_ignore_before('2026-11-20')`), /Só administradores/);
  await as(ADMIN);
  await db.query(`select public.set_pending_ignore_before('2026-11-20')`);
  assert.equal((await db.query<{ d: string }>(`select to_char(pending_ignore_before at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') as d from public.app_settings`)).rows[0].d, '2026-11-20 00:00');
  await db.query(`select public.set_pending_ignore_before(null)`);
  assert.equal((await db.query<{ v: string | null }>(`select pending_ignore_before as v from public.app_settings`)).rows[0].v, null);
});
