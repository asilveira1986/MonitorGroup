// Histórico de desconexões dos números (0195): o gatilho abre e fecha os períodos a cada mudança de situação.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0195_connection_log.sql', import.meta.url), 'utf8');
const COMPANY = '00000000-0000-0000-0000-0000000000c1';
const INST = '00000000-0000-0000-0000-0000000000a1';

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon;
    create schema if not exists public;
    create table public.companies (id uuid primary key);
    create table public.whatsapp_instances (id uuid primary key, company_id uuid, status text not null default 'disconnected', last_error text, last_seen_at timestamptz);
    create function public.is_admin() returns boolean language sql as $$ select true $$;
    create function public.is_platform_admin() returns boolean language sql as $$ select false $$;
    create function public.current_company_id() returns uuid language sql as $$ select '${COMPANY}'::uuid $$;
    insert into public.companies values ('${COMPANY}');
    insert into public.whatsapp_instances (id, company_id, status) values ('${INST}', '${COMPANY}', 'disconnected');
  `);
  await db.exec(MIGRATION);
  return db;
}

const periods = async (db: PGlite) =>
  (await db.query<{ started_at: Date; ended_at: Date | null; reason: string | null }>('select started_at, ended_at, reason from public.whatsapp_connection_log order by started_at')).rows;

test('queda abre um período, a reconexão fecha, com o motivo', async () => {
  const db = await setup();
  await db.exec(`update public.whatsapp_instances set status = 'connected', last_seen_at = now(), last_error = null where id = '${INST}'`);
  assert.equal((await periods(db)).length, 0, 'conectar sem queda antes não registra nada');

  await db.exec(`update public.whatsapp_instances set status = 'connecting', last_error = 'Reconectando, tentativa 1 (código 428: Connection Closed)' where id = '${INST}'`);
  let rows = await periods(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].ended_at, null, 'em aberto');
  assert.match(rows[0].reason ?? '', /Reconectando, tentativa 1/);

  // segue fora do ar (outra tentativa, depois desconectado com outro motivo): um período só, com o motivo mais recente
  await db.exec(`update public.whatsapp_instances set last_error = 'Reconectando, tentativa 2 (código 428: Connection Closed)' where id = '${INST}'`);
  await db.exec(`update public.whatsapp_instances set status = 'disconnected', last_error = 'Sessão encerrada no celular.' where id = '${INST}'`);
  rows = await periods(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reason, 'Sessão encerrada no celular.');
  assert.equal(rows[0].ended_at, null);

  await db.exec(`update public.whatsapp_instances set status = 'connecting', last_error = null where id = '${INST}'`);
  await db.exec(`update public.whatsapp_instances set status = 'connected', last_error = null, last_seen_at = now() where id = '${INST}'`);
  rows = await periods(db);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].ended_at, 'fechado ao reconectar');
  assert.equal(rows[0].reason, 'Sessão encerrada no celular.', 'o motivo fica');
});

test('número que nunca esteve conectado não gera período (QR, primeira conexão)', async () => {
  const db = await setup();
  await db.exec(`update public.whatsapp_instances set status = 'connecting' where id = '${INST}'`);
  await db.exec(`update public.whatsapp_instances set status = 'qr' where id = '${INST}'`);
  await db.exec(`update public.whatsapp_instances set status = 'connected' where id = '${INST}'`);
  assert.equal((await periods(db)).length, 0);
});

test('serviço parado: o período começa na última atividade registrada, não na volta do serviço', async () => {
  const db = await setup();
  await db.exec(`update public.whatsapp_instances set status = 'connected', last_seen_at = now() - interval '2 hours' where id = '${INST}'`);
  // o worker voltou e marca desconectado (estava "conectado" desde antes da queda)
  await db.exec(`update public.whatsapp_instances set status = 'disconnected' where id = '${INST}'`);
  const rows = await periods(db);
  assert.equal(rows.length, 1);
  const hoursAgo = (Date.now() - rows[0].started_at.getTime()) / 3_600_000;
  assert.ok(hoursAgo > 1.9 && hoursAgo < 2.1, `começou há ${hoursAgo.toFixed(2)} h`);
});

test('queda com o serviço ativo (atividade recente): começa agora', async () => {
  const db = await setup();
  await db.exec(`update public.whatsapp_instances set status = 'connected', last_seen_at = now() - interval '30 seconds' where id = '${INST}'`);
  await db.exec(`update public.whatsapp_instances set status = 'connecting', last_error = 'x' where id = '${INST}'`);
  const rows = await periods(db);
  assert.ok(Date.now() - rows[0].started_at.getTime() < 60_000);
});
