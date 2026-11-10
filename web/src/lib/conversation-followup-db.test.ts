// Pendência da conversa (0167): roda a migração num Postgres em memória (PGlite) e confere o "Não está pendente" e o
// recálculo pedido pelas Configurações.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0167_conversation_followup.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const AGENT = '00000000-0000-0000-0000-0000000000b1';
const VIEWER = '00000000-0000-0000-0000-0000000000b2';
const G = '00000000-0000-0000-0000-00000000f001';
const HIDDEN = '00000000-0000-0000-0000-00000000f002';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, email text, full_name text, role text);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create function public.can_write() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role <> 'viewer') $$;
    create function public.visible_group_ids() returns uuid[] language sql stable as $$ select array['${G}'::uuid] $$;
    create table public.app_settings (company_id uuid);
    create table public.groups (id uuid primary key, company_id uuid, name text);
    create table public.activity_log (id bigserial primary key, company_id uuid, user_id uuid, user_email text, user_name text,
      category text, action text, entity text, entity_id text, summary text, details jsonb);
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  await db.exec(`
    insert into public.profiles values ('${ADMIN}', '${CO}', 'ana@x.com', 'Ana', 'admin'), ('${AGENT}', '${CO}', 'bia@x.com', 'Bia', 'agent'),
      ('${VIEWER}', '${CO}', 'caio@x.com', '', 'viewer');
    insert into public.groups (id, company_id, name, followup_status, followup_kind, followup_excerpt, followup_updated_at)
      values ('${G}', '${CO}', 'FZP', 'company', 'promise', 'vou verificar', now()), ('${HIDDEN}', '${CO}', 'Outro', 'client', 'request', 'favor enviar', now());
  `);
  const as = async (uid: string, sql: string, params: unknown[] = []) => {
    await db.exec(`select set_config('test.uid', '${uid}', false)`);
    try {
      await db.query(sql, params);
      return null;
    } catch (e) {
      return (e as { code?: string }).code ?? 'erro';
    }
  };
  return { db, as };
}

test('"Não está pendente": atendente tira a pendência, fica registrado quem e quando, e o log ganha uma linha clara', async () => {
  const t = await setup();
  assert.equal(await t.as(AGENT, 'select public.dismiss_group_followup($1)', [G]), null);
  const g = (await t.db.query<Record<string, unknown>>(`select * from public.groups where id = $1`, [G])).rows[0];
  assert.equal(g.followup_status, 'resolved');
  assert.equal(g.followup_kind, 'manual');
  assert.equal(g.followup_excerpt, null);
  assert.equal(g.followup_dismissed_by, 'Bia');
  assert.ok(g.followup_dismissed_at);
  const log = (await t.db.query<{ summary: string }>(`select summary from public.activity_log`)).rows;
  assert.deepEqual(log.map((l) => l.summary), ['Marcou a conversa do grupo FZP como sem pendência']);
});

test('perfil somente ver e grupo que a pessoa não vê: recusados', async () => {
  const t = await setup();
  assert.equal(await t.as(VIEWER, 'select public.dismiss_group_followup($1)', [G]), '42501');
  assert.equal(await t.as(AGENT, 'select public.dismiss_group_followup($1)', [HIDDEN]), 'P0002');
});

test('recalcular pelas Configurações: só administrador, e zera o "calculado em" dos grupos da empresa', async () => {
  const t = await setup();
  assert.equal(await t.as(AGENT, 'select public.recompute_followups()'), '42501');
  assert.equal(await t.as(ADMIN, 'select public.recompute_followups()'), null);
  const n = (await t.db.query<{ n: number }>(`select count(*)::int n from public.groups where followup_updated_at is null`)).rows[0].n;
  assert.equal(n, 2);
  const cfg = (await t.db.query<{ followup_enabled: boolean }>(`insert into public.app_settings (company_id) values ('${CO}') returning followup_enabled`)).rows[0];
  assert.equal(cfg.followup_enabled, true, 'ligado por padrão');
});
