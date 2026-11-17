// Painel de conversas privadas (0183). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATION = readFileSync(new URL('../../../supabase/migrations/0183_private_panel.sql', import.meta.url), 'utf8');
const CO = '00000000-0000-0000-0000-0000000000c1';
const USER = '00000000-0000-0000-0000-0000000000a1';
const C = (n: number) => `00000000-0000-0000-0000-00000000c00${n}`;

async function setup() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, company_id uuid);
    create function public.current_company_id() returns uuid language sql stable as $$ select company_id from public.profiles where id = auth.uid() $$;
    create table public.app_settings (company_id uuid primary key, default_sla_minutes int, timezone text);
    create table public.private_chats (id uuid primary key, company_id uuid, instance_id uuid, name text, phone text, assigned_to uuid, tags uuid[] default '{}',
      unread_count int default 0, last_message_at timestamptz, last_message_preview text, closed_at timestamptz);
    create table public.private_messages (id uuid primary key default gen_random_uuid(), chat_id uuid, from_me boolean default false, sent_at timestamptz,
      deleted_at timestamptz, hidden_at timestamptz);
    insert into public.profiles values ('${USER}', '${CO}');
    insert into public.app_settings values ('${CO}', 30, 'America/Sao_Paulo');
    insert into public.private_chats (id, company_id, name, last_message_at) values
      ('${C(1)}', '${CO}', 'Atrasada', now() - interval '2 hours'),
      ('${C(2)}', '${CO}', 'Aguardando', now() - interval '5 minutes'),
      ('${C(3)}', '${CO}', 'Respondida', now() - interval '1 minute'),
      ('${C(4)}', '${CO}', 'Sem mensagens hoje', now() - interval '5 days'),
      ('${C(5)}', '${CO}', 'Encerrada', now());
    update public.private_chats set closed_at = now() where id = '${C(5)}';
    insert into public.private_messages (chat_id, from_me, sent_at) values
      ('${C(1)}', false, now() - interval '2 hours'), ('${C(1)}', false, now() - interval '119 minutes'),
      ('${C(2)}', false, now() - interval '5 minutes'),
      ('${C(3)}', false, now() - interval '10 minutes'), ('${C(3)}', true, now() - interval '1 minute'),
      ('${C(4)}', true, now() - interval '5 days'), ('${C(4)}', false, now() - interval '5 days');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION);
  await db.exec(`select set_config('test.uid', '${USER}', false)`);
  return db;
}

test('painel de privadas: situação, espera e contagens de cada conversa em aberto', async () => {
  const db = await setup();
  const r = (await db.query<{ p: { id: string; name: string; status: string; waiting_count: number | null; received_today: number; sent_today: number }[] }>(`select public.private_panel() p`)).rows[0].p;
  const by = Object.fromEntries(r.map((x) => [x.name, x]));
  assert.equal(by['Atrasada'].status, 'late');
  assert.equal(by['Atrasada'].waiting_count, 2);
  assert.equal(by['Aguardando'].status, 'waiting');
  assert.equal(by['Respondida'].status, 'answered');
  assert.equal(by['Respondida'].received_today, 1);
  assert.equal(by['Respondida'].sent_today, 1);
  assert.equal(by['Sem mensagens hoje'].status, 'neutral');
  assert.equal(by['Encerrada'], undefined, 'encerradas não entram');
  // ordem: atrasadas, aguardando, respondidas, sem mensagens
  assert.deepEqual(r.map((x) => x.name), ['Atrasada', 'Aguardando', 'Respondida', 'Sem mensagens hoje']);
});
