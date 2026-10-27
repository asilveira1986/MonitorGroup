'use client';

import { Download, Loader2, Save, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Input, Select } from '@/components/ui';
import { formatPhone } from '@/lib/format';
import { lgpdErase, lgpdSummary, saveMessageRetention, type PersonSummary } from './actions';

const OPTIONS = [
  { value: '', label: 'Sem prazo (guardar sempre)' },
  { value: '6', label: '6 meses' },
  { value: '12', label: '12 meses' },
  { value: '24', label: '24 meses' },
  { value: '36', label: '36 meses' },
  { value: '60', label: '5 anos' },
];

/** Prazo de guarda do conteúdo das mensagens (0096). */
export function RetentionCard({ months, disabled }: { months: number | null; disabled: boolean }) {
  const [value, setValue] = useState(months ? String(months) : '');
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardHeader
        title="Prazo de guarda das mensagens"
        description="Passado o prazo, o conteúdo e o remetente das mensagens (texto, nome, telefone, arquivo e citação) são apagados, nos grupos e no privado. Fica só o registro de que houve a mensagem (data, cliente ou equipe), para os indicadores e o histórico de atendimento não mudarem. Os arquivos seguem também o prazo próprio (Canais › WhatsApp)."
      />
      <div className="flex flex-wrap items-end gap-3 p-5">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink-2">Guardar o conteúdo por</span>
          <Select value={value} onChange={(e) => setValue(e.target.value)} disabled={disabled || pending} className="w-64">
            {OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        {!disabled && (
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                if (value && !confirm(`O conteúdo das mensagens com mais de ${OPTIONS.find((o) => o.value === value)?.label} será apagado de vez (o worker aplica em até 6 horas). Continuar?`))
                  return;
                const res = await saveMessageRetention(value ? Number(value) : null);
                if (res.ok) toast.success(value ? 'Prazo de guarda salvo' : 'Sem prazo de guarda');
                else toast.error(res.error);
              })
            }
          >
            <Save className="h-3.5 w-3.5" /> Salvar
          </Button>
        )}
        <p className="w-full text-[11px] text-muted">A LGPD pede guardar os dados pessoais só pelo tempo necessário para a finalidade (art. 15 e 16).</p>
      </div>
    </Card>
  );
}

const ROWS: { key: keyof PersonSummary; label: string }[] = [
  { key: 'mensagens_grupos', label: 'Mensagens nos grupos' },
  { key: 'grupos', label: 'Grupos em que aparece' },
  { key: 'conversas_privadas', label: 'Conversas privadas' },
  { key: 'mensagens_privadas', label: 'Mensagens no privado' },
  { key: 'contatos', label: 'Contatos do WhatsApp' },
  { key: 'reacoes', label: 'Reações' },
];

/** Pedidos do titular (LGPD art. 18): consultar, exportar e apagar os dados de uma pessoa pelo telefone. */
export function TitularRequests() {
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<PersonSummary | null>(null);
  const [pending, start] = useTransition();

  const search = () =>
    start(async () => {
      const res = await lgpdSummary(phone);
      if (!res.ok) {
        setFound(null);
        return void toast.error(res.error);
      }
      setFound(res.data!);
    });
  const erase = () => {
    if (!found) return;
    const typed = prompt(
      `Apagar os dados de ${formatPhone(found.telefone)}?\n\nSai o conteúdo e o remetente das mensagens dela nos grupos, as conversas privadas, o contato, as reações, a foto e a participação nos grupos. Não dá para desfazer.\n\nDigite APAGAR para confirmar:`,
    );
    if (typed?.trim().toUpperCase() !== 'APAGAR') return;
    start(async () => {
      const res = await lgpdErase(found.telefone);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Dados apagados', {
        description: `${res.data!.mensagens_grupos} mensagem(ns) nos grupos, ${res.data!.conversas_privadas} conversa(s) privada(s), ${res.data!.arquivos} arquivo(s).`,
      });
      const again = await lgpdSummary(found.telefone);
      if (again.ok) setFound(again.data!);
    });
  };
  const total = found ? ROWS.reduce((n, r) => n + Number(found[r.key] ?? 0), 0) : 0;

  return (
    <Card>
      <CardHeader
        title="Pedidos dos titulares"
        description="Quando alguém pede uma cópia dos próprios dados ou que eles sejam apagados (LGPD art. 18): busque pelo telefone, exporte o arquivo para entregar à pessoa e, se for o caso, apague. Cada consulta, exportação e exclusão fica no log de atividades."
      />
      <div className="space-y-4 p-5">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            search();
          }}
        >
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-2">Telefone da pessoa (com DDD)</span>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="51 99999-8888" className="w-64" required />
          </label>
          <Button disabled={pending || phone.replace(/\D/g, '').length < 10}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Buscar
          </Button>
        </form>

        {found && (
          <div className="rounded-xl border border-line p-4">
            <p className="text-sm font-semibold">
              {formatPhone(found.telefone)}
              {found.nomes?.length ? <span className="font-normal text-ink-2"> · {found.nomes.join(', ')}</span> : null}
            </p>
            {found.atendente && (
              <p className="mt-1 text-xs text-warning-ink">
                Este telefone é de um atendente: para apagar, remova-o antes em Configurações › Pessoas.
              </p>
            )}
            <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ROWS.map((r) => (
                <div key={r.key} className="rounded-lg bg-surface-2 px-3 py-2">
                  <dt className="text-[11px] text-muted">{r.label}</dt>
                  <dd className="tabular text-lg font-semibold">{Number(found[r.key] ?? 0)}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                href={`/lgpd/export?phone=${encodeURIComponent(found.telefone)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-sm font-medium hover:bg-surface-2"
              >
                <Download className="h-4 w-4" /> Exportar dados (JSON)
              </a>
              <Button variant="danger" disabled={pending || !total || found.atendente} onClick={erase}>
                <Trash2 className="h-4 w-4" /> Apagar dados da pessoa
              </Button>
            </div>
            {!total && (
              <p className="mt-3 flex items-center gap-1.5 text-xs text-good-ink">
                <ShieldCheck className="h-4 w-4" /> Nenhum dado desta pessoa guardado no sistema.
              </p>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
