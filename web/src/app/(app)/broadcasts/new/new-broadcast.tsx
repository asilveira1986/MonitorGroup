'use client';

import { Bookmark, CalendarClock, FileUp, Loader2, Paperclip, Plus, Send, Trash2, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { CustomerTag } from '@/components/customer-tags';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea, Toggle } from '@/components/ui';
import { AGENDA_COLORS, type AgendaColor } from '@/lib/agenda-colors';
import {
  DEFAULT_WINDOW,
  estimateSeconds,
  formatEstimate,
  hasCriteria,
  MAX_MEDIA_BYTES,
  MAX_VARIANTS,
  MEDIA_TYPE_LABEL,
  parseContactsCsv,
  renderBroadcast,
  WEEKDAY_LABEL,
  type BroadcastFilter,
  type BroadcastMedia,
  type BroadcastRecipient,
  type BroadcastSettingsValues,
  type BroadcastTarget,
  type BroadcastWindow,
  type SavedAudience,
} from '@/lib/broadcast';
import { cn } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { createBroadcast, deleteBroadcastAudience, prepareBroadcastUpload, previewAudience, saveBroadcastAudience } from '../actions';

export type GroupOption = { id: string; name: string };
export type InstanceOption = { id: string; name: string; phone: string | null; status: string };

const VARIABLES = [
  { token: '{primeiro_nome}', label: 'Primeiro nome' },
  { token: '{nome}', label: 'Nome' },
  { token: '{grupo}', label: 'Nome do grupo' },
];

/** Etiquetas como botões de marcar (várias). */
function TagPicker({ tags, value, onChange, empty }: { tags: CustomerTag[]; value: string[]; onChange: (v: string[]) => void; empty: string }) {
  if (tags.length === 0) return <p className="text-xs text-muted">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((t) => {
        const on = value.includes(t.id);
        const hex = AGENDA_COLORS[t.color as AgendaColor]?.hex ?? AGENDA_COLORS.blue.hex;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== t.id) : [...value, t.id])}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset transition',
              on ? 'bg-brand-soft text-ink ring-brand-line' : 'bg-surface text-ink-2 ring-line hover:bg-surface-2',
            )}
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hex }} aria-hidden />
            {t.name}
          </button>
        );
      })}
    </div>
  );
}

/** Lista com busca para marcar itens à mão (grupos ou pessoas). */
function ManualPicker({
  label,
  placeholder,
  selected,
  names,
  onToggle,
  fetchItems,
}: {
  label: string;
  placeholder: string;
  selected: string[];
  names: Record<string, string>;
  onToggle: (key: string, name: string) => void;
  fetchItems: (search: string) => Promise<BroadcastRecipient[]>;
}) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<BroadcastRecipient[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => {
      setLoading(true);
      void fetchItems(q).then((r) => {
        setItems(r.slice(0, 30));
        setLoading(false);
      });
    }, 300);
    return () => clearTimeout(t);
  }, [q, fetchItems]);

  return (
    <div className="space-y-2">
      <Field label={label}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      </Field>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((k) => (
            <button key={k} type="button" onClick={() => onToggle(k, names[k] ?? k)} className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-ink ring-1 ring-inset ring-brand-line hover:opacity-80" title="Tirar da lista">
              {names[k] || k} ×
            </button>
          ))}
        </div>
      )}
      {q.trim() && (
        <ul className="max-h-48 divide-y divide-line/60 overflow-y-auto rounded-xl border border-line/80">
          {loading && <li className="px-3 py-2 text-xs text-muted">Buscando…</li>}
          {!loading && items.length === 0 && <li className="px-3 py-2 text-xs text-muted">Nada encontrado.</li>}
          {items.map((it) => {
            const on = selected.includes(it.key);
            return (
              <li key={it.key}>
                <button type="button" onClick={() => onToggle(it.key, it.name || it.sub || it.key)} className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2">
                  <span className="min-w-0 truncate">
                    {it.name || it.sub}
                    {it.name && it.sub && <span className="ml-2 text-xs text-muted">{it.sub}</span>}
                  </span>
                  {on && <Badge tone="brand">Escolhido</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function NewBroadcast({
  tags,
  sectors,
  groups,
  instances,
  rate,
  saved,
  timezone,
}: {
  tags: CustomerTag[];
  sectors: { id: string; name: string }[];
  groups: GroupOption[];
  instances: InstanceOption[];
  rate: BroadcastSettingsValues;
  saved: SavedAudience[];
  timezone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [name, setName] = useState('');
  const [target, setTarget] = useState<BroadcastTarget>('groups');
  const [all, setAll] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<'any' | 'all'>('any');
  const [excludeIds, setExcludeIds] = useState<string[]>([]);
  const [sectorId, setSectorId] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [phones, setPhones] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [instanceId, setInstanceId] = useState(instances.find((i) => i.status === 'connected')?.id ?? instances[0]?.id ?? '');
  const [message, setMessage] = useState('');
  const [when, setWhen] = useState<'now' | 'later'>('now');
  const [at, setAt] = useState('');
  // fase 2
  const [extra, setExtra] = useState<{ phone: string; name: string | null }[]>([]);
  const [csvInfo, setCsvInfo] = useState<string | null>(null);
  const [variants, setVariants] = useState<string[]>([]);
  const [media, setMedia] = useState<BroadcastMedia | null>(null);
  const [uploading, setUploading] = useState(false);
  const [windowOn, setWindowOn] = useState(false);
  const [win, setWin] = useState<BroadcastWindow>(DEFAULT_WINDOW);
  const [footer, setFooter] = useState(true);
  const [savedList, setSavedList] = useState(saved);
  const [saveName, setSaveName] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);

  const [foundTotal, setTotal] = useState(0);
  const [foundRows, setRows] = useState<BroadcastRecipient[]>([]);
  const [skip, setSkip] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const filter: BroadcastFilter = useMemo(
    () => ({
      target,
      all,
      tag_ids: tagIds,
      tag_mode: tagMode,
      exclude_tag_ids: excludeIds,
      sector_id: target === 'groups' && sectorId ? sectorId : null,
      group_ids: target === 'groups' ? groupIds : [],
      phones: target === 'people' ? phones : [],
      extra: target === 'people' ? extra : [],
    }),
    [target, all, tagIds, tagMode, excludeIds, sectorId, groupIds, phones, extra],
  );
  const filterKey = JSON.stringify(filter);

  // a lista de quem recebe se atualiza sozinha quando o filtro muda
  useEffect(() => {
    if (!hasCriteria(filter)) return;
    const t = setTimeout(() => {
      setLoading(true);
      void previewAudience(filter, { limit: 500 }).then((r) => {
        setLoading(false);
        if (r.ok) {
          setRows(r.rows);
          setTotal(r.total);
          setPreviewError(null);
        } else {
          setPreviewError(r.error);
        }
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  // sem critério não há público (os valores antigos da busca anterior não aparecem)
  const hasFilter = hasCriteria(filter);
  const rows = hasFilter ? foundRows : [];
  const total = hasFilter ? foundTotal : 0;
  const skipSet = new Set(skip);
  const skippedHere = rows.filter((r) => skipSet.has(r.key)).length;
  const count = Math.max(0, total - skippedHere);
  const sample = rows.find((r) => !skipSet.has(r.key));

  const changeTarget = (t: BroadcastTarget) => {
    setTarget(t);
    setAll(false);
    setSkip([]);
    setExtra([]);
    setCsvInfo(null);
  };
  const toggleIn = (list: string[], set: (v: string[]) => void, key: string, label: string) => {
    set(list.includes(key) ? list.filter((x) => x !== key) : [...list, key]);
    setPicked((p) => ({ ...p, [key]: label }));
  };
  const fetchPeople = useMemo(
    () => async (search: string) => {
      const r = await previewAudience({ target: 'people', all: true }, { limit: 30, search });
      return r.ok ? r.rows : [];
    },
    [],
  );
  const fetchGroups = useMemo(
    () => async (search: string) => {
      const s = search.trim().toLowerCase();
      return groups.filter((g) => g.name.toLowerCase().includes(s)).map((g) => ({ key: g.id, name: g.name, sub: null }));
    },
    [groups],
  );

  const insertVariable = (token: string) => setMessage((m) => `${m}${m && !m.endsWith(' ') && !m.endsWith('\n') ? ' ' : ''}${token}`);

  const instanceOk = target === 'groups' || Boolean(instanceId);
  const hasContent = Boolean(message.trim() || media);
  const canSend = name.trim() && hasContent && count > 0 && instanceOk && (when === 'now' || at) && (!windowOn || win.days.length > 0) && !loading && !pending && !uploading;

  const names: Record<string, string> = { ...Object.fromEntries(groups.map((g) => [g.id, g.name])), ...picked };

  const importCsv = async (file: File) => {
    const parsed = parseContactsCsv(await file.text());
    setExtra(parsed.rows.slice(0, 5000));
    setCsvInfo(
      `${parsed.rows.length} número(s) importado(s)` +
        (parsed.invalid ? `, ${parsed.invalid} linha(s) sem telefone válido ignorada(s)` : '') +
        (parsed.duplicates ? `, ${parsed.duplicates} repetido(s)` : '') +
        '.',
    );
    if (csvRef.current) csvRef.current.value = '';
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const prep = await prepareBroadcastUpload({ name: file.name, mime: file.type, size: file.size });
      if (!prep.ok) {
        toast.error(prep.error);
        return;
      }
      const up = await createClient().storage.from('media').uploadToSignedUrl(prep.media.path, prep.token, file, { contentType: prep.media.mime });
      if (up.error) {
        toast.error('Não foi possível enviar o arquivo. Tente de novo.');
        return;
      }
      setMedia(prep.media);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const applySaved = (a: SavedAudience) => {
    const f = a.filter;
    setTarget(a.target);
    setAll(Boolean(f.all));
    setTagIds(f.tag_ids ?? []);
    setTagMode(f.tag_mode === 'all' ? 'all' : 'any');
    setExcludeIds(f.exclude_tag_ids ?? []);
    setSectorId(f.sector_id ?? '');
    setGroupIds(f.group_ids ?? []);
    setPhones(f.phones ?? []);
    setExtra((f.extra ?? []).map((e) => ({ phone: e.phone, name: e.name ?? null })));
    setCsvInfo(f.extra?.length ? `${f.extra.length} número(s) importado(s).` : null);
    setSkip([]);
    toast.success(`Público “${a.name}” carregado.`);
  };

  const saveAudience = () =>
    start(async () => {
      const r = await saveBroadcastAudience(saveName, filter);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setSavedList((l) => [...l.filter((x) => x.name.toLowerCase() !== saveName.trim().toLowerCase()), { id: r.id, name: saveName.trim(), target, filter }].sort((a, b) => a.name.localeCompare(b.name)));
      setSaveName('');
      toast.success('Público salvo.');
    });

  const removeSaved = (a: SavedAudience) =>
    start(async () => {
      const r = await deleteBroadcastAudience(a.id);
      if (!r.ok) toast.error(r.error);
      else setSavedList((l) => l.filter((x) => x.id !== a.id));
    });

  const submit = () =>
    start(async () => {
      const r = await createBroadcast({
        name,
        filter,
        message,
        instanceId: target === 'people' ? instanceId : null,
        scheduledAt: when === 'later' && at ? new Date(at).toISOString() : null,
        skip,
        variants: variants.map((v) => v.trim()).filter(Boolean),
        media,
        window: windowOn ? win : null,
        optoutFooter: footer,
      });
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      toast.success(when === 'later' ? 'Disparo agendado.' : 'Disparo iniciado.');
      router.push(`/broadcasts/${r.id}`);
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div className="space-y-6">
        <Card>
          <CardHeader title="1. Para quem" description="Combine filtros. O público é conferido na lista ao lado antes de enviar." />
          <div className="space-y-5 p-4 sm:p-5">
            <Field label="Nome do disparo" hint="Só para você se achar depois.">
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ex.: Aviso de feriado" />
            </Field>

            <div className="flex gap-2">
              {(['groups', 'people'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => changeTarget(t)}
                  className={cn('rounded-xl px-4 py-2 text-sm font-medium transition', target === t ? 'btn-signal text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink')}
                >
                  {t === 'groups' ? 'Grupos' : 'Pessoas (mensagem individual)'}
                </button>
              ))}
            </div>

            {(savedList.length > 0 || hasFilter) && (
              <div className="space-y-2 rounded-xl bg-surface-2 p-3">
                <p className="flex items-center gap-1.5 text-xs font-medium text-ink-2">
                  <Bookmark className="h-3.5 w-3.5" /> Públicos salvos
                </p>
                {savedList.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {savedList.map((a) => (
                      <span key={a.id} className="inline-flex items-center overflow-hidden rounded-full bg-surface text-xs font-medium ring-1 ring-inset ring-line">
                        <button type="button" onClick={() => applySaved(a)} className="px-2.5 py-1 text-ink hover:bg-brand-soft" title="Usar este público">
                          {a.name} <span className="text-muted">· {a.target === 'groups' ? 'grupos' : 'pessoas'}</span>
                        </button>
                        <button type="button" onClick={() => removeSaved(a)} className="px-1.5 py-1 text-muted hover:text-critical-ink" aria-label={`Excluir o público ${a.name}`}>
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                {hasFilter && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={80} placeholder="Nome para salvar o filtro atual" className="max-w-xs" />
                    <Button type="button" variant="secondary" size="sm" onClick={saveAudience} disabled={!saveName.trim() || pending}>
                      Salvar público
                    </Button>
                  </div>
                )}
              </div>
            )}

            <Toggle checked={all} onChange={setAll} label={target === 'groups' ? 'Todos os grupos ativos' : 'Todas as pessoas com telefone (contatos, conversas e agenda)'} />

            <div className="space-y-2">
              <p className="text-xs font-medium text-ink-2">Por etiqueta</p>
              <TagPicker tags={tags} value={tagIds} onChange={setTagIds} empty="Nenhuma etiqueta criada ainda. Crie em Configurações › Etiquetas." />
              {tagIds.length > 1 && (
                <Select value={tagMode} onChange={(e) => setTagMode(e.target.value as 'any' | 'all')} className="max-w-sm">
                  <option value="any">Quem tem QUALQUER uma das etiquetas</option>
                  <option value="all">Quem tem TODAS as etiquetas</option>
                </Select>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-ink-2">Excluir quem tem a etiqueta</p>
              <TagPicker tags={tags} value={excludeIds} onChange={setExcludeIds} empty="Sem etiquetas." />
            </div>

            {target === 'groups' && sectors.length > 0 && (
              <Field label="Por setor" hint="Junto com etiquetas, precisa cumprir os dois.">
                <Select value={sectorId} onChange={(e) => setSectorId(e.target.value)} className="max-w-sm">
                  <option value="">Qualquer setor</option>
                  {sectors.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {target === 'groups' ? (
              <ManualPicker
                label="Escolher grupos à mão (somam ao filtro)"
                placeholder="Buscar grupo pelo nome"
                selected={groupIds}
                names={names}
                onToggle={(k, n) => toggleIn(groupIds, setGroupIds, k, n)}
                fetchItems={fetchGroups}
              />
            ) : (
              <ManualPicker
                label="Escolher pessoas à mão (somam ao filtro)"
                placeholder="Buscar por nome ou telefone"
                selected={phones}
                names={names}
                onToggle={(k, n) => toggleIn(phones, setPhones, k, n)}
                fetchItems={fetchPeople}
              />
            )}

            {target === 'people' && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-ink-2">Importar números (CSV)</p>
                <p className="text-xs text-muted">Arquivo com uma linha por pessoa: telefone, ou nome e telefone (com ou sem cabeçalho). Todos entram no público.</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input ref={csvRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => e.target.files?.[0] && void importCsv(e.target.files[0])} />
                  <Button type="button" variant="secondary" size="sm" onClick={() => csvRef.current?.click()}>
                    <FileUp className="h-4 w-4" /> Escolher arquivo
                  </Button>
                  {extra.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => { setExtra([]); setCsvInfo(null); }}>
                      <X className="h-4 w-4" /> Limpar
                    </Button>
                  )}
                </div>
                {csvInfo && <p className="text-xs text-ink-2">{csvInfo}</p>}
              </div>
            )}

            {target === 'people' && (
              <Field label="Número do WhatsApp que envia" hint="Cada pessoa recebe a mensagem no privado, uma a uma.">
                <Select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} className="max-w-sm">
                  {instances.length === 0 && <option value="">Nenhum número conectado</option>}
                  {instances.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                      {i.phone ? ` (${i.phone})` : ''}
                      {i.status !== 'connected' ? ' — desconectado' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="2. Mensagem" description="Cada destinatário recebe o texto com as variáveis trocadas. Com arquivo, o texto vira a legenda." />
          <div className="space-y-3 p-4 sm:p-5">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={7} maxLength={4000} placeholder={target === 'people' ? 'Olá {primeiro_nome}, tudo bem? …' : 'Bom dia, pessoal! …'} />
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted">Inserir:</span>
              {VARIABLES.filter((v) => (target === 'groups' ? v.token !== '{primeiro_nome}' : v.token !== '{grupo}')).map((v) => (
                <button key={v.token} type="button" onClick={() => insertVariable(v.token)} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-medium text-ink-2 ring-1 ring-inset ring-line hover:text-ink">
                  {v.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-muted">{message.length}/4000</span>
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-ink-2">Variações do texto (opcional)</p>
              <p className="text-xs text-muted">Cada destinatário recebe uma delas (ou o texto principal) sorteada. Mensagens diferentes reduzem o risco de bloqueio.</p>
              {variants.map((v, i) => (
                <div key={i} className="flex gap-2">
                  <Textarea value={v} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? e.target.value : x)))} rows={3} maxLength={4000} placeholder={`Variação ${i + 1}`} />
                  <button type="button" onClick={() => setVariants(variants.filter((_, j) => j !== i))} className="h-9 shrink-0 rounded-lg p-2 text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label={`Remover a variação ${i + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {variants.length < MAX_VARIANTS && (
                <Button type="button" variant="secondary" size="sm" onClick={() => setVariants([...variants, ''])}>
                  <Plus className="h-4 w-4" /> Adicionar variação
                </Button>
              )}
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-ink-2">Arquivo (opcional)</p>
              <input ref={fileRef} type="file" className="sr-only" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
              {media ? (
                <div className="flex items-center justify-between gap-2 rounded-xl border border-line/80 px-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted" />
                    <span className="truncate">{media.name}</span>
                    <Badge tone="brand">{MEDIA_TYPE_LABEL[media.type]}</Badge>
                  </span>
                  <button type="button" onClick={() => setMedia(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label="Tirar o arquivo">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <Button type="button" variant="secondary" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />} {uploading ? 'Enviando…' : 'Anexar imagem, vídeo, documento ou áudio'}
                </Button>
              )}
              <p className="text-xs text-muted">Até {MAX_MEDIA_BYTES / 1024 / 1024} MB. Áudio vai sem texto.</p>
            </div>

            {target === 'people' && (
              <Toggle checked={footer} onChange={setFooter} label="Incluir “Para não receber mais mensagens, responda SAIR.” no fim" />
            )}

            {(message.trim() || media) && (
              <div className="rounded-xl bg-surface-2 p-3">
                <p className="mb-1 text-xs font-medium text-muted">Prévia{sample?.name ? ` para ${sample.name}` : ''}</p>
                {media && <p className="mb-1 flex items-center gap-1.5 text-xs text-ink-2"><Paperclip className="h-3.5 w-3.5" /> {MEDIA_TYPE_LABEL[media.type]}: {media.name}</p>}
                <p className="whitespace-pre-wrap text-sm text-ink">
                  {renderBroadcast(message, sample?.name)}
                  {target === 'people' && footer && media?.type !== 'audio' && `${message.trim() ? '\n\n' : ''}Para não receber mais mensagens, responda SAIR.`}
                </p>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="3. Quando enviar" />
          <div className="space-y-3 p-4 sm:p-5">
            <div className="flex gap-2">
              <button type="button" onClick={() => setWhen('now')} className={cn('rounded-xl px-4 py-2 text-sm font-medium transition', when === 'now' ? 'btn-signal text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink')}>
                Agora
              </button>
              <button type="button" onClick={() => setWhen('later')} className={cn('inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-medium transition', when === 'later' ? 'btn-signal text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink')}>
                <CalendarClock className="h-4 w-4" /> Agendar
              </button>
            </div>
            {when === 'later' && (
              <Field label="Data e hora" hint="No horário do seu navegador. O envio começa nessa hora, no ritmo configurado.">
                <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="max-w-xs" />
              </Field>
            )}
            <div className="space-y-3 border-t border-line/60 pt-3">
              <Toggle checked={windowOn} onChange={setWindowOn} label="Só enviar em certos dias e horários" />
              {windowOn && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {WEEKDAY_LABEL.map((d, i) => {
                      const on = win.days.includes(i);
                      return (
                        <button
                          key={d}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setWin({ ...win, days: on ? win.days.filter((x) => x !== i) : [...win.days, i].sort() })}
                          className={cn('rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset transition', on ? 'bg-brand-soft text-ink ring-brand-line' : 'bg-surface text-ink-2 ring-line hover:bg-surface-2')}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <Field label="Das">
                      <Input type="time" value={win.start} onChange={(e) => setWin({ ...win, start: e.target.value })} className="w-32" />
                    </Field>
                    <Field label="Até">
                      <Input type="time" value={win.end} onChange={(e) => setWin({ ...win, end: e.target.value })} className="w-32" />
                    </Field>
                  </div>
                  <p className="text-xs text-muted">Fuso da empresa: {timezone}. Fora desse horário o envio espera e continua sozinho quando a janela abrir.</p>
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="xl:sticky xl:top-4">
          <CardHeader
            title="4. Revisão"
            action={loading && hasFilter ? <Loader2 className="h-4 w-4 animate-spin text-muted" aria-label="Atualizando" /> : undefined}
          />
          <div className="space-y-3 p-4 sm:p-5">
            {!hasFilter ? (
              <p className="text-sm text-muted">Escolha um filtro para ver quem vai receber.</p>
            ) : previewError ? (
              <p className="text-sm text-critical-ink">{previewError}</p>
            ) : (
              <>
                <p className="flex items-center gap-2 text-sm text-ink">
                  <Users className="h-4 w-4 text-muted" />
                  <strong>{count}</strong> {target === 'groups' ? 'grupo(s)' : 'pessoa(s)'} vão receber
                  {skip.length > 0 && <span className="text-muted">({skip.length} tirado(s))</span>}
                </p>
                {count > 0 && <p className="text-xs text-muted">Tempo estimado no ritmo atual: {formatEstimate(estimateSeconds(count, rate))}.</p>}
                {count > rate.dailyLimit && (
                  <p className="rounded-lg bg-warning/15 px-3 py-2 text-xs text-warning-ink">
                    Passa do limite de {rate.dailyLimit} mensagens em 24 h por número: o envio continua no dia seguinte, sozinho.
                  </p>
                )}
                {rows.length > 0 && (
                  <ul className="max-h-80 divide-y divide-line/60 overflow-y-auto rounded-xl border border-line/80">
                    {rows.map((r) => {
                      const off = skipSet.has(r.key);
                      return (
                        <li key={r.key}>
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-surface-2">
                            <input
                              type="checkbox"
                              checked={!off}
                              onChange={() => setSkip(off ? skip.filter((k) => k !== r.key) : [...skip, r.key])}
                              className="h-4 w-4 accent-brand"
                            />
                            <span className={cn('min-w-0 truncate', off && 'text-muted line-through')}>
                              {r.name || r.sub}
                              {r.name && r.sub && <span className="ml-2 text-xs text-muted">{r.sub}</span>}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {total > rows.length && (
                  <p className="text-xs text-muted">Mostrando os primeiros {rows.length} de {total}. Os demais também recebem; para tirar alguém, refine o filtro.</p>
                )}
              </>
            )}
            <Button onClick={submit} disabled={!canSend} className="w-full">
              <Send className="h-4 w-4" /> {pending ? 'Criando…' : when === 'later' ? 'Agendar disparo' : 'Enviar agora'}
            </Button>
            <p className="text-xs text-muted">Envie só para quem aceitou receber mensagens da sua empresa (LGPD). Mensagens em massa para quem não conhece o número podem levar ao bloqueio.</p>
          </div>
        </Card>
      </div>
    </div>
  );
}
