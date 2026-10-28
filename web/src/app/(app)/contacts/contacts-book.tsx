'use client';

import { Download, Loader2, MessageCircle, Pencil, Plus, Search, Trash2, UserPlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Card, Field, Input, Select, Textarea } from '@/components/ui';
import { Avatar } from '@/components/avatar';
import { TagChips, type CustomerTag } from '@/components/customer-tags';
import { createCustomerTag } from '@/app/(app)/tag-actions';
import { AGENDA_COLORS, type AgendaColor } from '@/lib/agenda-colors';
import { cn, formatPhone } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import { startPrivateChat } from '../private/actions';
import { deleteContact, saveContact, type ContactInput } from './actions';

/** linha da lista (contact_directory, 0112): uma por pessoa */
export type Contact = {
  jid: string;
  phone: string | null;
  name: string | null;
  notify: string | null;
  saved?: boolean;
  chat?: boolean;
  team?: boolean;
  /** cadastro no sistema */
  id?: string | null;
  chat_id?: string | null;
  email?: string | null;
  organization?: string | null;
  notes?: string | null;
  tags?: string[];
  /** identificador com foto de perfil guardada (0113) */
  photo?: string | null;
};
type Filter = 'all' | 'system' | 'whatsapp' | 'chat' | 'team';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'system', label: 'Cadastrados no sistema' },
  { key: 'whatsapp', label: 'Agenda do WhatsApp' },
  { key: 'chat', label: 'Com conversa' },
  { key: 'team', label: 'Equipe' },
];
const SHOW_STEP = 100;
const COLORS = Object.keys(AGENDA_COLORS) as AgendaColor[];

const titleOf = (c: Contact) => c.name || c.notify || formatPhone(c.phone) || c.email || 'Contato';
const initials = (s: string) =>
  s
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w[0] ?? ''))
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '#';

/** Novo contato ou edição: nome, telefone, e-mail, empresa, observações e etiquetas. */
export function ContactDialog({
  contact,
  tags: allTags,
  onClose,
  onSaved,
  heading,
}: {
  contact: Contact | null;
  tags: CustomerTag[];
  onClose: () => void;
  onSaved: () => void;
  /** título da janela (padrão: "Novo contato" / "Editar contato") */
  heading?: string;
}) {
  const [form, setForm] = useState<ContactInput>({
    name: contact?.name ?? contact?.notify ?? '',
    phone: contact?.phone ?? '',
    email: contact?.email ?? '',
    organization: contact?.organization ?? '',
    notes: contact?.notes ?? '',
    tags: contact?.tags ?? [],
  });
  const [list, setList] = useState(allTags);
  const [newTag, setNewTag] = useState('');
  const [pending, start] = useTransition();
  const set = (k: keyof ContactInput) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  // contato só da agenda do WhatsApp (ou de uma conversa): salvar cria o cadastro no sistema
  const fromWhatsApp = Boolean(contact && !contact.id);
  const title = heading ?? (contact ? 'Editar contato' : 'Novo contato');

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const toggle = (id: string) => setForm({ ...form, tags: form.tags.includes(id) ? form.tags.filter((t) => t !== id) : [...form.tags, id] });
  const addTag = () =>
    start(async () => {
      const color = COLORS[(list.length + 4) % COLORS.length];
      const res = await createCustomerTag(newTag, color);
      if (!res.ok) return void toast.error(res.error);
      if (!list.some((t) => t.id === res.data)) setList([...list, { id: res.data, name: newTag.trim(), color }].sort((a, b) => a.name.localeCompare(b.name)));
      setForm((f) => ({ ...f, tags: [...new Set([...f.tags, res.data])] }));
      setNewTag('');
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-2xl bg-surface shadow-2xl sm:rounded-2xl"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await saveContact(contact?.id ?? null, form);
            if (!res.ok) return void toast.error(res.error);
            toast.success(contact?.id ? 'Contato salvo' : 'Contato cadastrado');
            onSaved();
            onClose();
          });
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line p-4">
          <div>
            <h2 className="text-base font-semibold">{title}</h2>
            {fromWhatsApp && (
              <p className="text-xs text-ink-2">Salvar cadastra o contato no sistema. O nome muda no painel e nas conversas; a agenda do celular não muda.</p>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-4 sm:grid-cols-2">
          <Field label="Nome">
            <Input value={form.name} onChange={set('name')} required maxLength={120} autoFocus />
          </Field>
          <Field label="WhatsApp (com DDD)">
            <Input value={form.phone} onChange={set('phone')} inputMode="tel" placeholder="51 99999-8888" />
          </Field>
          <Field label="E-mail">
            <Input value={form.email} onChange={set('email')} type="email" maxLength={200} />
          </Field>
          <Field label="Empresa">
            <Input value={form.organization} onChange={set('organization')} maxLength={120} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Observações">
              <Textarea value={form.notes} onChange={set('notes')} rows={3} maxLength={2000} />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-sm font-medium">Etiquetas</p>
            <div className="flex flex-wrap gap-1.5">
              {list.map((t) => {
                const on = form.tags.includes(t.id);
                const hex = AGENDA_COLORS[t.color]?.hex ?? AGENDA_COLORS.blue.hex;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggle(t.id)}
                    aria-pressed={on}
                    className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs', on ? 'font-medium text-ink' : 'border-line text-ink-2')}
                    style={on ? { backgroundColor: `${hex}24`, borderColor: `${hex}88` } : undefined}
                  >
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: hex }} aria-hidden />
                    {t.name}
                  </button>
                );
              })}
              <span className="inline-flex items-center gap-1">
                <input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (newTag.trim()) addTag();
                    }
                  }}
                  placeholder="Nova etiqueta"
                  maxLength={40}
                  aria-label="Nova etiqueta"
                  className="h-7 w-32 rounded-full border border-dashed border-line bg-surface px-2.5 text-base outline-none focus:border-brand-line sm:text-xs"
                />
                {newTag.trim() && (
                  <button type="button" onClick={addTag} disabled={pending} className="rounded-full p-1 text-brand-text hover:bg-surface-2" aria-label="Criar etiqueta">
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line p-4">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button disabled={pending || !form.name.trim()}>{pending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar</Button>
        </div>
      </form>
    </div>
  );
}

/** Lista de contatos com busca, filtros e as ações (novo, editar, conversar, excluir, exportar). */
export function ContactsBook({ tags }: { tags: CustomerTag[] }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tag, setTag] = useState('');
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [shown, setShown] = useState(SHOW_STEP);
  const [editing, setEditing] = useState<Contact | 'new' | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, start] = useTransition();

  useEffect(() => {
    const term = q.trim();
    const timer = setTimeout(
      () => {
        void createClient()
          .rpc('contact_directory', { p_search: term || null, p_limit: 20000 })
          .then(({ data, error }) => {
            if (error) toast.error('Não foi possível carregar os contatos.');
            setContacts((data ?? []) as Contact[]);
            setShown(SHOW_STEP);
          });
      },
      term ? 250 : 0,
    );
    return () => clearTimeout(timer);
  }, [q, reload]);
  const refresh = useCallback(() => setReload((n) => n + 1), []);

  const list = useMemo(
    () =>
      (contacts ?? []).filter(
        (c) =>
          (filter === 'all' ||
            (filter === 'system' && c.id) ||
            (filter === 'whatsapp' && c.saved) ||
            (filter === 'chat' && c.chat) ||
            (filter === 'team' && c.team)) &&
          (!tag || c.tags?.includes(tag)),
      ),
    [contacts, filter, tag],
  );

  const talk = (c: Contact) =>
    start(async () => {
      // sempre pelo banco: a conversa de outro usuário avisa com quem está (0114)
      const res = await startPrivateChat(c.jid.startsWith('contact:') ? { phone: c.phone ?? '', name: c.name ?? undefined } : { jid: c.jid, name: c.name ?? c.notify ?? undefined });
      if (!res.ok) return void toast.error(res.error);
      router.push(`/private?c=${res.data!.id}`);
    });
  const remove = (c: Contact) => {
    if (!c.id || !confirm(`Excluir o cadastro de "${titleOf(c)}"? A agenda do WhatsApp e as conversas continuam.`)) return;
    start(async () => {
      const res = await deleteContact(c.id!);
      if (!res.ok) return void toast.error(res.error);
      toast.success('Contato excluído');
      refresh();
    });
  };
  // planilha (CSV, abre no Excel) com o que está na lista
  const exportCsv = () => {
    const cell = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
    const names = (ids?: string[]) => (ids ?? []).map((id) => tags.find((t) => t.id === id)?.name).filter(Boolean).join(', ');
    const lines = [
      ['Nome', 'Nome no WhatsApp', 'Telefone', 'E-mail', 'Empresa', 'Etiquetas', 'Observações'].map(cell).join(';'),
      ...list.map((c) => [c.name, c.notify, c.phone, c.email, c.organization, names(c.tags), c.notes].map(cell).join(';')),
    ];
    const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'contatos.csv' });
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, número, e-mail ou empresa" className="pl-9" aria-label="Buscar contato" />
        </div>
        {tags.length > 0 && (
          <Select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Filtrar por etiqueta" className="w-auto">
            <option value="">Todas as etiquetas</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
        <Button type="button" variant="secondary" onClick={exportCsv} disabled={!list.length}>
          <Download className="h-4 w-4" /> Exportar
        </Button>
        <Button type="button" onClick={() => setEditing('new')}>
          <UserPlus className="h-4 w-4" /> Novo contato
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium',
              filter === f.key ? 'btn-signal text-brand-ink' : 'bg-surface-2 text-ink-2 hover:text-ink',
            )}
          >
            {f.label}
          </button>
        ))}
        {contacts && <span className="ml-auto text-xs text-muted">{list.length} contato(s)</span>}
      </div>

      <ul className="divide-y divide-line">
        {contacts === null && (
          <li className="flex items-center gap-2 px-4 py-4 text-sm text-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando contatos…
          </li>
        )}
        {contacts && !list.length && (
          <li className="px-4 py-6 text-center text-sm text-muted">
            Nenhum contato encontrado. Use “Sincronizar contatos” para trazer a agenda do WhatsApp conectado, ou cadastre um em “Novo contato”.
          </li>
        )}
        {list.slice(0, shown).map((c) => {
          const title = titleOf(c);
          const sub = [c.phone ? (formatPhone(c.phone) === title ? null : formatPhone(c.phone)) : c.jid.endsWith('@lid') ? 'sem número' : null, c.name && c.notify && c.notify !== c.name ? `~${c.notify}` : null, c.email, c.organization]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={c.jid} className="flex flex-wrap items-center gap-3 px-4 py-2.5 sm:flex-nowrap">
              <Avatar jid={c.photo} hasPhoto={Boolean(c.photo)} name={title} fallback={initials(title)} className="h-10 w-10 rounded-full bg-brand-soft text-xs text-brand-text" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{title}</span>
                  <span className="flex gap-1 text-[10px]">
                    {c.id && <span className="rounded-full bg-warning/15 px-1.5 text-warning-ink" title="Cadastrado no sistema">sistema</span>}
                    {c.saved && <span className="rounded-full bg-surface-2 px-1.5 text-ink-2" title="Salvo na agenda do WhatsApp conectado">agenda</span>}
                    {c.chat && <span className="rounded-full bg-brand-soft px-1.5 text-brand-text" title="Tem conversa no privado">conversa</span>}
                    {c.team && <span className="rounded-full bg-good/15 px-1.5 text-good-ink" title="Pessoa da equipe">equipe</span>}
                  </span>
                  <TagChips ids={c.tags} all={tags} size="xs" />
                </p>
                {sub && <p className="truncate text-xs text-muted">{sub}</p>}
                {c.notes && <p className="line-clamp-1 text-xs text-ink-2">📝 {c.notes}</p>}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={pending || (!c.phone && !c.chat_id && c.jid.startsWith('contact:'))}
                  onClick={() => talk(c)}
                  title="Abrir a conversa no privado"
                >
                  <MessageCircle className="h-4 w-4" /> <span className="hidden md:inline">Conversar</span>
                </Button>
                <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => setEditing(c)} title="Editar">
                  <Pencil className="h-4 w-4" /> <span className="hidden md:inline">Editar</span>
                </Button>
                {c.id && (
                  <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={() => remove(c)} title="Excluir o cadastro do sistema" aria-label="Excluir">
                    <Trash2 className="h-4 w-4 text-critical-ink" />
                  </Button>
                )}
              </div>
            </li>
          );
        })}
        {list.length > shown && (
          <li className="p-3">
            <Button type="button" size="sm" variant="secondary" className="w-full" onClick={() => setShown(shown + SHOW_STEP)}>
              Mostrar mais ({list.length - shown})
            </Button>
          </li>
        )}
      </ul>

      {editing && (
        <ContactDialog contact={editing === 'new' ? null : editing} tags={tags} onClose={() => setEditing(null)} onSaved={refresh} />
      )}
    </Card>
  );
}
