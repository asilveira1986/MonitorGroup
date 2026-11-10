import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diagnose, recoveryLimitText, type ReceiveDiagnosis } from './receive-diagnosis.ts';

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();
const fmt = (iso: string) => iso.slice(0, 16);
const base = (over: Partial<ReceiveDiagnosis> = {}): ReceiveDiagnosis => ({
  group: { last_message_at: ago(1), monitored: true, removed_at: null, undecrypted_count: 0, last_undecrypted_at: null, last_undecrypted_reason: null },
  instance: { name: 'Cível', phone: '5551981666317', status: 'connected', last_seen_at: ago(0), connected_at: ago(100), last_error: null, last_message_at: ago(0.5), groups_active_24h: 12 },
  copies: [],
  auto_request: null,
  ...over,
});
const tones = (f: { tone: string }[]) => f.map((x) => x.tone);

test('tudo normal', () => {
  const f = diagnose(base(), NOW, fmt);
  assert.deepEqual(tones(f), ['good']);
});

test('só este grupo parado (6 dias), número recebendo outros: aviso com a data', () => {
  const f = diagnose(base({ group: { ...base().group, last_message_at: ago(144) } }), NOW, fmt);
  assert.equal(f[0].tone, 'warning');
  assert.match(f[0].text, /recebe outros grupos normalmente \(12 com mensagens/);
  assert.match(f[0].text, new RegExp(fmt(ago(144))));
});

test('número desconectado ou travado (conectado sem receber nada há dias)', () => {
  const off = diagnose(base({ instance: { ...base().instance!, status: 'disconnected' } }), NOW, fmt);
  assert.equal(off[0].tone, 'critical');
  assert.match(off[0].text, /desconectado/);
  const stuck = diagnose(base({ group: { ...base().group, last_message_at: ago(144) }, instance: { ...base().instance!, last_message_at: ago(140), groups_active_24h: 0 } }), NOW, fmt);
  assert.equal(stuck[0].tone, 'critical');
  assert.match(stuck[0].text, /conexão travou/);
});

test('mensagens chegando pela outra cópia do grupo', () => {
  const f = diagnose(
    base({
      group: { ...base().group, last_message_at: ago(144) },
      copies: [
        { name: 'Trabalhista', phone: null, status: 'connected', monitored: false, removed_at: null, last_message_at: ago(20) },
        { name: 'Antigo', phone: null, status: 'connected', monitored: true, removed_at: null, last_message_at: ago(200) },
      ],
    }),
    NOW,
    fmt,
  );
  const copy = f.filter((x) => /cópia/.test(x.text));
  assert.equal(copy.length, 1, 'só a cópia mais nova que este grupo');
  assert.match(copy[0].text, /Trabalhista.*sem monitoramento/);
});

test('mensagens que não puderam ser abertas e pedido automático', () => {
  const f = diagnose(
    base({
      group: { ...base().group, undecrypted_count: 3, last_undecrypted_at: ago(2) },
      auto_request: { status: 'done', created_at: ago(1), messages_added: 7, note: null },
    }),
    NOW,
    fmt,
  );
  assert.ok(f.some((x) => x.tone === 'warning' && /3 mensagem\(ns\).*não conseguiu abrir/.test(x.text)));
  assert.ok(f.some((x) => /concluída \(7 mensagem/.test(x.text)));
  assert.ok(!f.some((x) => x.tone === 'good'));
});

test('texto do limite da recuperação', () => {
  assert.match(recoveryLimitText(ago(144), fmt), /ANTES da última mensagem guardada/);
  assert.match(recoveryLimitText(null, fmt), /pelo menos uma mensagem guardada/);
});
