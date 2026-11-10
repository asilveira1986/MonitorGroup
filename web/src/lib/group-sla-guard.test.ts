// SLA do grupo só para administradores (0173): roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0173_group_sla_admin_only.sql', import.meta.url), 'utf8');
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const AGENT = '00000000-0000-0000-0000-0000000000b1';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, role text, platform_admin boolean default false);
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and (role = 'admin' or platform_admin)) $$;
    create table public.groups (id uuid primary key default gen_random_uuid(), name text, monitored boolean not null default true, sla_minutes int);
    insert into public.profiles values ('${ADMIN}', 'admin'), ('${AGENT}', 'agent');
    insert into public.groups (name, sla_minutes) values ('G1', 30);
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const as = async (uid: string | null, sql: string) => {
    await db.exec(`select set_config('test.uid', '${uid ?? ''}', false)`);
    try {
      await db.exec(sql);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  };
  const sla = async () => (await db.query<{ s: number | null }>(`select sla_minutes s from public.groups`)).rows[0].s;
  return { as, sla };
}

test('atendente não muda o SLA do grupo; administrador muda; vazio volta ao padrão', async () => {
  const t = await setup();
  const denied = await t.as(AGENT, `update public.groups set sla_minutes = 5`);
  assert.match(denied ?? '', /Só administradores mudam o SLA/);
  assert.equal(await t.sla(), 30);
  assert.equal(await t.as(ADMIN, `update public.groups set sla_minutes = 45`), null);
  assert.equal(await t.sla(), 45);
  assert.equal(await t.as(ADMIN, `update public.groups set sla_minutes = null`), null);
  assert.equal(await t.sla(), null);
});

test('o monitoramento continua só do administrador, e outras edições do atendente passam', async () => {
  const t = await setup();
  assert.match((await t.as(AGENT, `update public.groups set monitored = false`)) ?? '', /ligam ou desligam o monitoramento/);
  assert.equal(await t.as(AGENT, `update public.groups set name = 'G1 novo'`), null);
  assert.equal(await t.as(AGENT, `update public.groups set sla_minutes = 30`), null, 'mesmo valor não é mudança');
});

test('worker e SQL Editor (sem usuário logado) continuam podendo', async () => {
  const t = await setup();
  assert.equal(await t.as(null, `update public.groups set sla_minutes = 10, monitored = false`), null);
  assert.equal(await t.sla(), 10);
});
