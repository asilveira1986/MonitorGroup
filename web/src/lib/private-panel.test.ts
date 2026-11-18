// Painel de conversas privadas (0183). Roda a migração num Postgres em memória (PGlite).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS = ['0183_private_panel.sql', '0184_private_panel_today_only.sql', '0185_private_opens_pending.sql'].map((f) => readFileSync(new URL(`../../../supabase/migrations/${f}`, import.meta.url), 'utf8'));
const CO = '00000000-0000-0000-0000-0000000000c1';
const USER = '00000000-0000-0000-0000-0000000000a1';
// o dia de "hoje" do painel segue o fuso da empresa: usa um fuso em que agora é por volta do meio-dia, para o teste não depender
// da hora em que roda (perto da meia-noite as mensagens de poucas horas atrás seriam de "ontem")
const offset = 12 - new Date().getUTCHours();
const TZ = offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;
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
    -- (a coluna opens_pending vem da 0185)
    insert into public.profiles values ('${USER}', '${CO}');
    insert into public.app_settings values ('${CO}', 30, '${TZ}');
    insert into public.private_chats (id, company_id, name, last_message_at) values
      ('${C(1)}', '${CO}', 'Atrasada', now() - interval '2 hours'),
      ('${C(7)}', '${CO}', 'Só bom dia e vou verificar', now() - interval '1 minute'),
      ('${C(6)}', '${CO}', 'Esperando desde ontem', now() - interval '30 hours'),
      ('${C(2)}', '${CO}', 'Aguardando', now() - interval '5 minutes'),
      ('${C(3)}', '${CO}', 'Respondida', now() - interval '1 minute'),
      ('${C(4)}', '${CO}', 'Sem mensagens hoje', now() - interval '5 days'),
      ('${C(5)}', '${CO}', 'Encerrada', now());
    update public.private_chats set closed_at = now() where id = '${C(5)}';
    insert into public.private_messages (chat_id, from_me, sent_at) values
      ('${C(1)}', false, now() - interval '2 hours'), ('${C(1)}', false, now() - interval '119 minutes'),
      ('${C(6)}', false, now() - interval '30 hours'),
      ('${C(2)}', false, now() - interval '5 minutes'),
      ('${C(7)}', true, now() - interval '2 minutes'), ('${C(7)}', false, now() - interval '1 minute'),
      ('${C(3)}', false, now() - interval '10 minutes'), ('${C(3)}', true, now() - interval '1 minute'),
      ('${C(4)}', true, now() - interval '5 days'), ('${C(4)}', false, now() - interval '5 days');
  `);
  for (const m of MIGRATIONS) await db.exec(m);
  for (const m of MIGRATIONS) await db.exec(m);
  // as mensagens do cliente "bom dia" / "vou verificar" não pedem resposta
  await db.exec(`update public.private_messages set opens_pending = false where chat_id = '${C(7)}' and not from_me`);
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
  // o cliente só respondeu "bom dia"/"vou verificar" (opens_pending = false): nada pendente, conversa de hoje
  assert.equal(by['Só bom dia e vou verificar'].status, 'answered');
  assert.equal(by['Só bom dia e vou verificar'].waiting_count, 0);
  // sem resposta desde ontem (ou antes): não conta como pendente
  assert.equal(by['Esperando desde ontem'].status, 'neutral');
  assert.equal(by['Esperando desde ontem'].waiting_count, 0);
  // ordem: atrasadas, aguardando, respondidas, sem mensagens
  assert.deepEqual(r.map((x) => x.name).slice(0, 2), ['Atrasada', 'Aguardando']);
});
