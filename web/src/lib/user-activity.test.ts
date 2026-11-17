// Acompanhamento: últimas atividades de um usuário (0180). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0180_user_recent_activity.sql', import.meta.url), 'utf8');
const CO1 = '00000000-0000-0000-0000-0000000000c1';
const CO2 = '00000000-0000-0000-0000-0000000000c2';
const PLATFORM = '00000000-0000-0000-0000-0000000000a1';
const ADMIN1 = '00000000-0000-0000-0000-0000000000a2';
const ANA = '00000000-0000-0000-0000-0000000000b1';
const EVA = '00000000-0000-0000-0000-0000000000b9';
const AGENT = '00000000-0000-0000-0000-0000000000b2';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, email text, role text, platform_admin boolean default false);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create function public.is_platform_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and platform_admin) $$;
    create table public.activity_log (id bigint generated always as identity primary key, created_at timestamptz default now(), company_id uuid, user_id uuid, user_email text, user_name text,
      category text, action text, entity text, summary text);
    insert into public.profiles values ('${PLATFORM}', '${CO1}', 'plat@x.com', 'admin', true), ('${ADMIN1}', '${CO1}', 'adm@x.com', 'admin', false),
      ('${ANA}', '${CO1}', 'ana@x.com', 'agent', false), ('${EVA}', '${CO2}', 'eva@x.com', 'agent', false), ('${AGENT}', '${CO1}', 'ag@x.com', 'agent', false);
    insert into public.activity_log (created_at, company_id, user_id, user_email, category, action, entity, summary) values
      ('2026-11-17T10:00:00Z', '${CO1}', '${ANA}', 'ana@x.com', 'atendimento', 'respondeu', 'outgoing_messages', 'Respondeu no grupo Contel'),
      ('2026-11-17T11:00:00Z', '${CO1}', '${ANA}', 'ana@x.com', 'grupos', 'alterou', 'groups', 'Trocou o setor do grupo X'),
      ('2026-11-17T09:00:00Z', '${CO1}', null, 'ANA@x.com', 'demandas', 'criou', 'demands', 'Criou uma demanda'),
      ('2026-11-17T12:00:00Z', '${CO2}', '${EVA}', 'eva@x.com', 'grupos', 'alterou', 'groups', 'Outra empresa'),
      ('2026-11-17T13:00:00Z', '${CO1}', '${PLATFORM}', 'plat@x.com', 'empresas', 'alterou', 'companies', 'Ação da plataforma');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  const call = async (email: string, limit = 40) =>
    (await db.query<{ r: { summary: string }[] }>(`select public.user_recent_activity($1, $2) r`, [email, limit])).rows[0].r;
  return { db, as, call };
}

test('administrador da empresa vê as atividades dos usuários da própria empresa, da mais recente à mais antiga', async () => {
  const { as, call } = await setup();
  await as(ADMIN1);
  assert.deepEqual((await call('ana@x.com')).map((a) => a.summary), ['Trocou o setor do grupo X', 'Respondeu no grupo Contel', 'Criou uma demanda']);
  assert.equal((await call('ANA@x.com', 2)).length, 2, 'limite');
  assert.deepEqual(await call('ag@x.com'), [], 'sem atividade');
  assert.deepEqual(await call('naoexiste@x.com'), []);
});

test('administrador da empresa não vê outra empresa nem quem administra a plataforma; atendente não vê ninguém', async () => {
  const { as, call } = await setup();
  await as(ADMIN1);
  await assert.rejects(call('eva@x.com'), /Usuário não encontrado/);
  await assert.rejects(call('plat@x.com'), /Usuário não encontrado/);
  await as(AGENT);
  await assert.rejects(call('ana@x.com'), /Só administradores/);
});

test('administrador da plataforma vê qualquer usuário', async () => {
  const { as, call } = await setup();
  await as(PLATFORM);
  assert.deepEqual((await call('eva@x.com')).map((a) => a.summary), ['Outra empresa']);
  assert.equal((await call('plat@x.com')).length, 1);
});
