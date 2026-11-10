// Diagnóstico de recebimento do grupo (0165): roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0165_group_receive_diagnosis.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const CO2 = '00000000-0000-0000-0000-0000000000c2';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const AGENT = '00000000-0000-0000-0000-0000000000b1';
const OTHER = '00000000-0000-0000-0000-0000000000a9';
const I1 = '00000000-0000-0000-0000-0000000000e1';
const I2 = '00000000-0000-0000-0000-0000000000e2';
const G = '00000000-0000-0000-0000-00000000f001';
const G_COPY = '00000000-0000-0000-0000-00000000f002';
const G_OTHER = '00000000-0000-0000-0000-00000000f003';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid, role text);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create function public.is_admin() returns boolean language sql stable as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') $$;
    create table public.whatsapp_instances (id uuid primary key, company_id uuid, name text, phone text, status text,
      last_seen_at timestamptz, connected_at timestamptz, last_error text);
    create table public.groups (id uuid primary key, company_id uuid, instance_id uuid, jid text, name text,
      monitored boolean default true, removed_at timestamptz, last_message_at timestamptz);
    create table public.history_requests (id uuid primary key default gen_random_uuid(), group_id uuid, requested_by uuid,
      batch_id uuid, status text, created_at timestamptz default now(), messages_added int default 0, note text);
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  await db.exec(`
    insert into public.profiles values ('${ADMIN}', '${CO}', 'admin'), ('${AGENT}', '${CO}', 'agent'), ('${OTHER}', '${CO2}', 'admin');
    insert into public.whatsapp_instances values
      ('${I1}', '${CO}', 'Cível', '5551981666317', 'connected', now(), now() - interval '10 days', null),
      ('${I2}', '${CO}', 'Trabalhista', '5551900000000', 'connected', now(), now() - interval '2 days', null);
    insert into public.groups (id, company_id, instance_id, jid, name, last_message_at) values
      ('${G}', '${CO}', '${I1}', '123@g.us', 'FZP', now() - interval '6 days'),
      ('${G_COPY}', '${CO}', '${I2}', '123@g.us', 'FZP', now() - interval '1 hour'),
      ('${G_OTHER}', '${CO}', '${I1}', '999@g.us', 'Outro', now() - interval '2 hours');
    insert into public.history_requests (group_id, requested_by, status, note) values ('${G}', null, 'pending', 'Pedido automático');
  `);
  const as = async (uid: string, sql: string, params: unknown[] = []) => {
    await db.exec(`select set_config('test.uid', '${uid}', false)`);
    try {
      return { ok: true as const, rows: (await db.query<Record<string, unknown>>(sql, params)).rows };
    } catch (e) {
      return { ok: false as const, code: (e as { code?: string }).code };
    }
  };
  return { db, as };
}

test('diagnóstico: número que monitora, último recebimento do número, cópias do grupo e pedido automático', async () => {
  const t = await setup();
  const res = await t.as(ADMIN, 'select public.group_receive_diagnosis($1) d', [G]);
  assert.ok(res.ok);
  const d = res.rows[0].d as {
    group: { undecrypted_count: number };
    instance: { name: string; status: string; groups_active_24h: number; last_message_at: string };
    copies: { name: string; last_message_at: string }[];
    auto_request: { status: string } | null;
  };
  assert.equal(d.instance.name, 'Cível');
  assert.equal(d.instance.status, 'connected');
  assert.equal(d.instance.groups_active_24h, 1, 'o número recebe outros grupos: o problema é só este grupo');
  assert.ok(Date.now() - new Date(d.instance.last_message_at).getTime() < 3 * 3600_000);
  assert.deepEqual(d.copies.map((c) => c.name), ['Trabalhista'], 'a outra cópia do mesmo grupo, em outro número');
  assert.equal(d.group.undecrypted_count, 0);
  assert.equal(d.auto_request?.status, 'pending');
});

test('contagem de mensagens não abertas: soma, desconta o reenvio e nunca fica negativa', async () => {
  const t = await setup();
  await t.db.exec(`select set_config('test.uid', '', false)`);
  await t.db.query(`select public.note_undecrypted_message($1, 1, 'No SenderKeyRecord found for decryption')`, [G]);
  await t.db.query(`select public.note_undecrypted_message($1, 1, null)`, [G]);
  await t.db.query(`select public.note_undecrypted_message($1, -1, null)`, [G]);
  let row = (await t.db.query<{ n: number; r: string }>(`select undecrypted_count n, last_undecrypted_reason r from public.groups where id = $1`, [G])).rows[0];
  assert.equal(row.n, 1);
  assert.equal(row.r, 'No SenderKeyRecord found for decryption', 'o reenvio não apaga o último motivo');
  await t.db.query(`select public.note_undecrypted_message($1, -1, null)`, [G]);
  await t.db.query(`select public.note_undecrypted_message($1, -1, null)`, [G]);
  row = (await t.db.query<{ n: number; r: string }>(`select undecrypted_count n, last_undecrypted_reason r from public.groups where id = $1`, [G])).rows[0];
  assert.equal(row.n, 0);
});

test('só administradores da própria empresa', async () => {
  const t = await setup();
  const agent = await t.as(AGENT, 'select public.group_receive_diagnosis($1) d', [G]);
  assert.equal(agent.ok ? null : agent.code, '42501');
  const other = await t.as(OTHER, 'select public.group_receive_diagnosis($1) d', [G]);
  assert.equal(other.ok ? null : other.code, 'P0002');
});
