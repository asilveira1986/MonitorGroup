'use client';

import { ArrowDown, ArrowUp, Plus, Save, Tags, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, CardHeader, Input } from '@/components/ui';
import { saveDemandTypes } from '../actions';

export type DemandType = { name: string; keywords: string[] };
type Row = DemandType & { key: number; orig: string | null; draft: string };

const toTags = (text: string) =>
  [...new Set(text.split(/[,;\n]+/).map((k) => k.trim().replace(/\s+/g, ' ')).filter(Boolean))];

/**
 * Tipos de demanda: o nome aparece na demanda (criação, filtro e relatórios) e as palavras-chave
 * classificam sozinhas as demandas abertas pelo WhatsApp (o primeiro tipo cujas palavras aparecem vence).
 */
export function DemandTypes({ initial, counts, canEdit }: { initial: DemandType[]; counts: Record<string, number>; canEdit: boolean }) {
  const router = useRouter();
  const [seq, setSeq] = useState(initial.length);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((t, i) => ({ ...t, key: i, orig: t.name, draft: t.keywords.join(', ') })),
  );
  const [pending, start] = useTransition();
  const lock = !canEdit || pending;

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = i + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = () => {
    setRows((rs) => [...rs, { key: seq, name: '', keywords: [], orig: null, draft: '' }]);
    setSeq((s) => s + 1);
  };
  const remove = (r: Row) => {
    const n = r.orig ? (counts[r.orig] ?? 0) : 0;
    if (n && !confirm(`${n} demanda(s) usam o tipo "${r.orig}". Elas mantêm esse nome, mas ele sai da lista de tipos. Remover?`)) return;
    setRows((rs) => rs.filter((x) => x.key !== r.key));
  };

  const save = () => {
    const types = rows.map((r) => ({ name: r.name.trim().replace(/\s+/g, ' '), keywords: toTags(r.draft) }));
    if (types.some((t) => !t.name)) return void toast.error('Dê um nome a cada tipo (ou remova os vazios).');
    const lower = types.map((t) => t.name.toLowerCase());
    if (new Set(lower).size !== lower.length) return void toast.error('Há tipos com o mesmo nome.');
    const renames = rows
      .map((r, i) => ({ from: r.orig, to: types[i].name }))
      .filter((x): x is { from: string; to: string } => Boolean(x.from) && x.from !== x.to);
    start(async () => {
      const res = await saveDemandTypes(types, renames);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Tipos de demanda salvos', {
        description: res.renamed ? `${res.renamed} demanda(s) passaram para o novo nome.` : undefined,
      });
      setRows(types.map((t, i) => ({ ...t, key: rows[i].key, orig: t.name, draft: t.keywords.join(', ') })));
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader
        title="Tipos de demanda"
        description="Os tipos que aparecem ao criar e filtrar demandas e nos relatórios. As palavras-chave classificam sozinhas as demandas abertas pelo WhatsApp: vale o primeiro tipo da lista cujas palavras aparecem na mensagem."
      />
      <div className="space-y-2 px-4 pb-4 sm:px-5">
        {rows.length === 0 && <p className="py-4 text-sm text-muted">Nenhum tipo cadastrado. As demandas ficam sem tipo.</p>}
        {rows.map((r, i) => (
          <div key={r.key} className="flex flex-col gap-2 rounded-xl border border-line p-3 sm:flex-row sm:items-start">
            <div className="flex items-center gap-1 sm:flex-col sm:pt-1">
              <span className="tabular w-6 text-center text-xs font-semibold text-muted">{i + 1}</span>
              <button type="button" disabled={lock || i === 0} onClick={() => move(i, -1)} className="rounded-md p-1 text-ink-2 hover:bg-surface-2 disabled:opacity-30" aria-label={`Subir ${r.name || 'tipo'}`}>
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={lock || i === rows.length - 1}
                onClick={() => move(i, 1)}
                className="rounded-md p-1 text-ink-2 hover:bg-surface-2 disabled:opacity-30"
                aria-label={`Descer ${r.name || 'tipo'}`}
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="sm:w-56">
              <Input value={r.name} onChange={(e) => set(r.key, { name: e.target.value })} placeholder="Nome do tipo" aria-label="Nome do tipo" maxLength={60} disabled={lock} />
              <p className="mt-1 text-[11px] text-muted">
                {r.orig && counts[r.orig] ? `${counts[r.orig]} demanda(s) com este tipo` : 'nenhuma demanda ainda'}
                {r.orig && r.name.trim() && r.name.trim() !== r.orig && <span className="text-warning-ink"> · será renomeado</span>}
              </p>
            </div>
            <div className="min-w-0 flex-1">
              <Input
                value={r.draft}
                onChange={(e) => set(r.key, { draft: e.target.value })}
                placeholder="Palavras-chave, separadas por vírgula (ex.: boleto, nota fiscal, pix)"
                aria-label={`Palavras-chave de ${r.name || 'tipo'}`}
                disabled={lock}
              />
              {toTags(r.draft).length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {toTags(r.draft).map((k) => (
                    <span key={k} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
                      {k}
                    </span>
                  ))}
                </div>
              )}
            </div>
            {canEdit && (
              <button
                type="button"
                disabled={lock}
                onClick={() => remove(r)}
                className="self-end rounded-lg p-2 text-ink-2 hover:bg-surface-2 hover:text-critical-ink sm:self-start"
                aria-label={`Remover ${r.name || 'tipo'}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {canEdit && (
          <div className="flex flex-wrap gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={add} disabled={lock}>
              <Plus className="h-4 w-4" /> Adicionar tipo
            </Button>
            <Button type="button" onClick={save} disabled={lock}>
              <Save className="h-4 w-4" /> {pending ? 'Salvando…' : 'Salvar tipos'}
            </Button>
          </div>
        )}
        <p className="flex items-start gap-1.5 pt-2 text-xs text-ink-2">
          <Tags className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Renomear um tipo também atualiza as demandas que já usam o nome antigo. Removido, o
          tipo some da lista, e as demandas antigas mantêm o nome.
        </p>
      </div>
    </Card>
  );
}
