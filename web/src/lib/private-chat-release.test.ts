// "Liberar conversa" (0164): roda a migração de verdade num Postgres em memória (PGlite), com o mínimo
// das tabelas e funções das migrações anteriores, e confere as regras pela função do banco
// (é ela que o painel chama: releasePrivateChat → release_private_chat).
// Códigos: 42501 = sem permissão (403), P0002 = não encontrada (404), 22023 = pedido inválido (400).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0164_private_chat_release.sql', import.meta.url), 'utf8');

const CO = '00000000-0000-0000-0000-0000000000c1';
const CO2 = '00000000-0000-0000-0000-0000000000c2';
const ADMIN = '00000000-0000-0000-0000-0000000000a1';
const ADMIN2 = '00000000-0000-0000-0000-0000000000a2';
const AGENT = '00000000-0000-0000-0000-0000000000b1';
const AGENT2 = '00000000-0000-0000-0000-0000000000b2';
const OTHER_ADMIN = '00000000-0000-0000-0000-0000000000a9';
const CHAT = '00000000-0000-0000-0000-00000000d001';
const LAST_MSG = '2026-11-10T12:00:00Z';

const BASE = `
  create role authenticated; create role anon; create schema auth;
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table public.companies (id uuid primary key);
  create table public.profiles (id uuid primary key, company_id uuid, email text, full_name text, role text,
    active boolean default true, platform_admin boolean default false);
  create table public.private_chats (id uuid primary key default gen_random_uuid(), company_id uuid, instance_id uuid,
    name text, phone text, assigned_to uuid references public.profiles(id), assigned_at timestamptz,
    closed_at timestamptz, closed_by uuid, unread_count int default 0, last_message_at timestamptz);
  create table public.private_outgoing (id uuid primary key default gen_random_uuid(), chat_id uuid, body text);
  create table public.activity_log (id bigserial primary key, company_id uuid, user_id uuid, user_email text, user_name text,
    category text, action text, entity text, entity_id text, summary text, details jsonb);
  create table public.pushes (company_id uuid, title text, body text, users uuid[]);
  create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
  create function public.can_use_private_chats() returns boolean language sql stable as $$ select auth.uid() is not null $$;
  create function public.is_admin() returns boolean language sql stable as $$
    select exists (select 1 from public.profiles where id = auth.uid() and active and (role = 'admin' or platform_admin)) $$;
  create function public.private_sees_all() returns boolean language sql stable as $$ select public.can_use_private_chats() and public.is_admin() $$;
  create function public.private_sees_team() returns boolean language sql stable as $$ select public.private_sees_all() $$;
  create function public.private_instance_ok(p uuid) returns boolean language sql stable as $$ select true $$;
  create function public.private_chat_visible(p_chat uuid) returns boolean language sql stable as $$
    select public.can_use_private_chats() and exists (select 1 from public.private_chats c
      where c.id = p_chat and c.company_id = public.current_company_id()
        and (c.assigned_to = auth.uid() or public.private_sees_team() or (c.assigned_to is null and public.private_instance_ok(c.instance_id)))) $$;
  create function public.user_display_name(p uuid) returns text language sql stable as $$
    select coalesce(nullif(btrim(full_name), ''), split_part(email, '@', 1), 'outro usuário') from public.profiles where id = p $$;
  create function public.queue_push(p_company uuid, p_kind text, p_audience text, p_title text, p_body text, p_url text,
    p_group uuid default null, p_users uuid[] default '{}', p_tag text default null, p_dedupe text default null)
    returns void language sql as $$ insert into public.pushes values (p_company, p_title, p_body, p_users) $$;
`;

async function setup() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION); // pode rodar de novo sem erro
  await db.exec(`
    create trigger private_outgoing_owner before insert on public.private_outgoing
      for each row execute function public.private_outgoing_owner();
    insert into public.companies values ('${CO}'), ('${CO2}');
    insert into public.profiles (id, company_id, email, full_name, role, platform_admin) values
      ('${ADMIN}', '${CO}', 'ana@x.com', 'Ana Admin', 'admin', false),
      ('${ADMIN2}', '${CO}', 'dora@x.com', 'Dora', 'agent', true),
      ('${AGENT}', '${CO}', 'bia@x.com', 'Bia', 'agent', false),
      ('${AGENT2}', '${CO}', 'caio@x.com', 'Caio', 'agent', false),
      ('${OTHER_ADMIN}', '${CO2}', 'eva@x.com', 'Eva', 'admin', false);
    insert into public.private_chats (id, company_id, name, phone, assigned_to, assigned_at, last_message_at)
      values ('${CHAT}', '${CO}', 'Cliente João', '5511999990000', '${AGENT}', now(), '${LAST_MSG}');
  `);
  const as = (uid: string) => db.exec(`select set_config('test.uid', '${uid}', false)`);
  const call = async (uid: string, sql: string, params: unknown[] = []) => {
    await as(uid);
    try {
      return { ok: true as const, rows: (await db.query<Record<string, unknown>>(sql, params)).rows };
    } catch (e) {
      const err = e as { code?: string; message: string };
      return { ok: false as const, code: err.code, message: err.message };
    }
  };
  const release = (uid: string, chat = CHAT, note: string | null = null) =>
    call(uid, 'select public.release_private_chat($1, $2) as chat', [chat, note]);
  const chat = async () =>
    (await db.query<{ assigned_to: string | null; assigned_at: string | null; released_from: string | null; last_message_at: Date }>(
      `select assigned_to, assigned_at, released_from, last_message_at from public.private_chats where id = '${CHAT}'`,
    )).rows[0];
  const events = async (type?: string) =>
    (await db.query<{ type: string; user_id: string; note: string | null; metadata: Record<string, string> }>(
      `select type, user_id, note, metadata from public.private_chat_events where chat_id = '${CHAT}'${type ? ` and type = '${type}'` : ''} order by created_at`,
    )).rows;
  return { db, call, release, chat, events };
}

test('administrador libera a conversa: sem responsável, evento no histórico, aviso e "sem resposta" intacto', async () => {
  const t = await setup();
  const res = await t.release(ADMIN, CHAT, '  cliente pediu outro atendente  ');
  assert.ok(res.ok, res.ok ? '' : res.message);
  const returned = res.rows[0].chat as { assigned_to: string | null; released_from: string };
  assert.equal(returned.assigned_to, null, 'devolve a conversa atualizada');
  assert.equal(returned.released_from, AGENT);

  const c = await t.chat();
  assert.equal(c.assigned_to, null);
  assert.equal(c.assigned_at, null);
  assert.equal(c.released_from, AGENT);
  assert.equal(c.last_message_at.toISOString(), new Date(LAST_MSG).toISOString(), 'a última mensagem do cliente não muda');

  const [ev] = await t.events('released');
  assert.equal(ev.user_id, ADMIN);
  assert.equal(ev.note, 'cliente pediu outro atendente');
  assert.equal(ev.metadata.from, AGENT);
  assert.equal(ev.metadata.from_name, 'Bia');
  assert.equal(ev.metadata.by_name, 'Ana Admin');
  assert.equal(ev.metadata.customer, 'Cliente João');

  const push = (await t.db.query<{ users: string[] }>('select users from public.pushes')).rows;
  assert.deepEqual(push.map((p) => p.users), [[AGENT]], 'quem atendia é avisado');
  const log = (await t.db.query<{ action: string }>(`select action from public.activity_log`)).rows;
  assert.deepEqual(log.map((l) => l.action), ['liberou']);
});

test('administrador da plataforma também libera conversa de qualquer atendente', async () => {
  const t = await setup();
  const res = await t.release(ADMIN2);
  assert.ok(res.ok);
  assert.equal((await t.chat()).assigned_to, null);
});

test('atendente comum recebe "sem permissão" (403) e nada muda', async () => {
  const t = await setup();
  for (const who of [AGENT, AGENT2]) {
    const res = await t.release(who);
    assert.equal(res.ok, false);
    assert.equal(res.ok ? null : res.code, '42501');
    assert.match(res.ok ? '' : res.message, /Só administradores/);
  }
  assert.equal((await t.chat()).assigned_to, AGENT);
  assert.equal((await t.events()).length, 0);
  // nem pelo "Transferir" devolvendo para a fila
  const viaAssign = await t.call(AGENT, 'select public.assign_private_chat($1, null, null)', [CHAT]);
  assert.equal(viaAssign.ok ? null : viaAssign.code, '42501');
  assert.equal((await t.chat()).assigned_to, AGENT);
});

test('conversa já sem responsável retorna erro claro (400)', async () => {
  const t = await setup();
  await t.db.exec(`update public.private_chats set assigned_to = null, assigned_at = null where id = '${CHAT}'`);
  const res = await t.release(ADMIN);
  assert.equal(res.ok ? null : res.code, '22023');
  assert.match(res.ok ? '' : res.message, /já está sem responsável/);
});

test('conversa inexistente ou de outra empresa retorna "não encontrada" (404)', async () => {
  const t = await setup();
  const missing = await t.release(ADMIN, '00000000-0000-0000-0000-00000000dfff');
  assert.equal(missing.ok ? null : missing.code, 'P0002');
  const otherCompany = await t.release(OTHER_ADMIN);
  assert.equal(otherCompany.ok ? null : otherCompany.code, 'P0002');
  assert.equal((await t.chat()).assigned_to, AGENT);
});

test('liberar duas vezes (dois cliques ou dois administradores): a segunda recebe 400 e há um só evento', async () => {
  const t = await setup();
  const [a, b] = [await t.release(ADMIN), await t.release(ADMIN2)];
  assert.ok(a.ok);
  assert.equal(b.ok ? null : b.code, '22023');
  assert.equal((await t.events('released')).length, 1);
  assert.equal((await t.chat()).released_from, AGENT, 'o bloqueio continua com quem atendia');
});

test('atendimento finalizado não é liberado (400)', async () => {
  const t = await setup();
  await t.db.exec(`update public.private_chats set closed_at = now() where id = '${CHAT}'`);
  const res = await t.release(ADMIN);
  assert.equal(res.ok ? null : res.code, '22023');
  assert.match(res.ok ? '' : res.message, /finalizado/);
});

test('quem perdeu a conversa só responde depois de assumir; o resto da equipe assume ao responder', async () => {
  const t = await setup();
  assert.ok((await t.release(ADMIN)).ok);
  const blocked = await t.call(AGENT, `insert into public.private_outgoing (chat_id, body) values ($1, 'oi')`, [CHAT]);
  assert.equal(blocked.ok ? null : blocked.code, '42501');
  assert.match(blocked.ok ? '' : blocked.message, /Assumir/);

  // assumir de novo tira o bloqueio
  assert.ok((await t.call(AGENT, 'select public.assign_private_chat($1, $2)', [CHAT, AGENT])).ok);
  let c = await t.chat();
  assert.equal(c.assigned_to, AGENT);
  assert.equal(c.released_from, null);
  assert.ok((await t.call(AGENT, `insert into public.private_outgoing (chat_id, body) values ($1, 'voltei')`, [CHAT])).ok);

  // liberada de novo: outro atendente responde e assume (como antes)
  assert.ok((await t.release(ADMIN)).ok);
  assert.ok((await t.call(AGENT2, `insert into public.private_outgoing (chat_id, body) values ($1, 'assumo eu')`, [CHAT])).ok);
  c = await t.chat();
  assert.equal(c.assigned_to, AGENT2);
  assert.equal(c.released_from, null);
  assert.deepEqual((await t.events()).map((e) => e.type), ['released', 'assigned', 'released', 'assigned']);
});

test('transferir e finalizar também ficam no histórico', async () => {
  const t = await setup();
  assert.ok((await t.call(AGENT, 'select public.assign_private_chat($1, $2, $3)', [CHAT, AGENT2, 'cliente do Caio'])).ok);
  assert.ok((await t.call(AGENT2, 'select public.finish_private_chat($1)', [CHAT])).ok);
  const evs = await t.events();
  assert.deepEqual(evs.map((e) => e.type), ['transferred', 'finished']);
  assert.equal(evs[0].metadata.from_name, 'Bia');
  assert.equal(evs[0].metadata.to_name, 'Caio');
  assert.equal(evs[0].note, 'cliente do Caio');
});
