'use client';

import { Building2, LogIn, MessagesSquare, Pencil, Plus, ShieldCheck, Smartphone, Users, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { ActionButton } from '@/components/action-button';
import { ActionForm } from '@/components/form-action';
import { Badge, Button, Card, Field, Input, Textarea } from '@/components/ui';
import { cn, formatNumber } from '@/lib/format';
import type { Company } from '@/lib/types';
import { addCompanyAdmin, createCompany, saveCompany, switchCompany, updateCompany } from './actions';

/** Campos da empresa (cadastro e edição). */
function CompanyFields({ company }: { company?: Company }) {
  return (
    <>
      <Field label="Nome da empresa">
        <Input name="name" required defaultValue={company?.name} placeholder="Ex.: Acme Telecom" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="CNPJ (opcional)">
          <Input name="document" defaultValue={company?.document ?? ''} placeholder="00.000.000/0001-00" />
        </Field>
        <Field label="Contato">
          <Input name="contact_name" defaultValue={company?.contact_name ?? ''} placeholder="Nome do responsável" />
        </Field>
        <Field label="E-mail do contato">
          <Input name="contact_email" type="email" defaultValue={company?.contact_email ?? ''} placeholder="contato@empresa.com" />
        </Field>
        <Field label="Telefone do contato">
          <Input name="contact_phone" defaultValue={company?.contact_phone ?? ''} placeholder="(11) 99999-8888" />
        </Field>
        <Field label="Limite de grupos monitorados" hint="Em branco: sem limite.">
          <Input name="max_groups" type="number" min={1} defaultValue={company?.max_groups ?? ''} placeholder="sem limite" />
        </Field>
        <Field label="Limite de usuários" hint="Em branco: sem limite.">
          <Input name="max_users" type="number" min={1} defaultValue={company?.max_users ?? ''} placeholder="sem limite" />
        </Field>
      </div>
      <Field label="Observações (só a plataforma vê)">
        <Textarea name="notes" rows={2} defaultValue={company?.notes ?? ''} placeholder="Plano, condições, datas…" />
      </Field>
    </>
  );
}

export function NewCompanyForm() {
  return (
    <ActionForm action={createCompany} success="Empresa cadastrada e acesso liberado" resetOnSuccess className="space-y-3">
      {(pending) => (
        <>
          <CompanyFields />
          <div className="rounded-xl border border-line bg-surface-2/50 p-3">
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-brand-text" aria-hidden /> Administrador da empresa
            </p>
            <div className="space-y-3">
              <Field label="Nome">
                <Input name="admin_name" placeholder="Nome do administrador" />
              </Field>
              <Field label="E-mail de acesso">
                <Input name="admin_email" type="email" required placeholder="admin@empresa.com" />
              </Field>
              <Field label="Senha inicial" hint="Envie à pessoa; ela pode trocar em “Esqueci minha senha”.">
                <Input name="admin_password" type="password" required minLength={8} autoComplete="new-password" placeholder="mínimo 8 caracteres" />
              </Field>
            </div>
          </div>
          <Button disabled={pending} className="w-full">
            <Plus className="h-4 w-4" /> {pending ? 'Cadastrando…' : 'Cadastrar empresa'}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

/** Uso diante do limite: "8 de 10". */
function Usage({ icon: Icon, label, value, max }: { icon: typeof Users; label: string; value: number; max?: number | null }) {
  const full = max != null && value >= max;
  return (
    <div className="min-w-0 rounded-xl bg-surface-2/60 px-3 py-2">
      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </p>
      <p className={cn('mt-0.5 text-sm font-semibold', full && 'text-warning-ink')}>
        <span className="tabular">{formatNumber(value)}</span>
        {max != null && <span className="font-normal text-muted"> de {formatNumber(max)}</span>}
      </p>
    </div>
  );
}

export function CompanyCard({ company: c, current }: { company: Company; current: boolean }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [entering, start] = useTransition();

  return (
    <Card className={cn('p-4 sm:p-5', !c.active && 'opacity-80')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-deep text-on-deep">
            <Building2 className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="truncate font-semibold">{c.name}</span>
              {c.active ? <Badge tone="good">Acesso liberado</Badge> : <Badge tone="critical">Suspensa</Badge>}
              {current && <Badge tone="brand">Você está aqui</Badge>}
            </p>
            <p className="truncate text-xs text-muted">
              {[c.document, c.contact_name, c.contact_email, c.contact_phone].filter(Boolean).join(' · ') || 'Sem dados de contato'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={current ? 'secondary' : 'primary'}
            disabled={entering}
            onClick={() =>
              start(async () => {
                const res = await switchCompany(c.id);
                if (res && !res.ok) toast.error(res.error);
              })
            }
            title="Ver e configurar o sistema como esta empresa (suporte)"
          >
            <LogIn className="h-3.5 w-3.5" /> {current ? 'Abrir' : 'Entrar na empresa'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing((v) => !v)}>
            {editing ? <X className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />} {editing ? 'Fechar' : 'Editar'}
          </Button>
          {c.active ? (
            <ActionButton
              variant="danger"
              action={() => updateCompany(c.id, { active: false })}
              confirm={`Suspender o acesso de "${c.name}"? Os usuários dela não entram mais e o WhatsApp dela é desconectado (a sessão fica salva). Os dados são mantidos.`}
              success="Acesso suspenso"
            >
              Suspender
            </ActionButton>
          ) : (
            <ActionButton action={() => updateCompany(c.id, { active: true })} success="Acesso liberado">
              Liberar acesso
            </ActionButton>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Usage icon={Users} label="Usuários" value={c.users} max={c.max_users} />
        <Usage icon={MessagesSquare} label="Grupos monitorados" value={c.groups_monitored} max={c.max_groups} />
        <Usage icon={Smartphone} label="WhatsApp conectado" value={c.connected} max={c.connections || null} />
        <Usage icon={MessagesSquare} label="Mensagens (30 dias)" value={c.messages_30d} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span>
          Administradores: {c.admins.length ? c.admins.join(', ') : <span className="text-warning-ink">nenhum</span>}
          {c.pending_invites > 0 && <span className="text-muted"> · {c.pending_invites} convite(s) sem acesso</span>}
        </span>
        <button type="button" className="font-medium text-brand-text hover:underline" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Cancelar' : '+ Adicionar administrador'}
        </button>
        <span className="text-muted">
          Cliente desde {new Date(c.created_at).toLocaleDateString('pt-BR')}
          {c.last_message_at && ` · última mensagem ${new Date(c.last_message_at).toLocaleDateString('pt-BR')}`}
        </span>
      </div>
      {c.notes && <p className="mt-2 rounded-lg bg-surface-2/60 px-3 py-2 text-xs text-ink-2">{c.notes}</p>}

      {adding && (
        <ActionForm
          action={(form) => addCompanyAdmin(c.id, form)}
          success="Administrador cadastrado"
          resetOnSuccess
          onDone={() => setAdding(false)}
          className="mt-3 grid gap-3 rounded-xl border border-line p-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        >
          {(pending) => (
            <>
              <Field label="Nome">
                <Input name="name" placeholder="Nome" />
              </Field>
              <Field label="E-mail">
                <Input name="email" type="email" required placeholder="pessoa@empresa.com" />
              </Field>
              <Field label="Senha inicial">
                <Input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="mín. 8 caracteres" />
              </Field>
              <Button disabled={pending} size="sm">
                {pending ? 'Salvando…' : 'Adicionar'}
              </Button>
            </>
          )}
        </ActionForm>
      )}

      {editing && (
        <ActionForm
          action={(form) => saveCompany(c.id, form)}
          success="Empresa atualizada"
          onDone={() => setEditing(false)}
          className="mt-4 space-y-3 border-t border-line pt-4"
        >
          {(pending) => (
            <>
              <CompanyFields company={c} />
              <Button disabled={pending} size="sm">
                {pending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          )}
        </ActionForm>
      )}
    </Card>
  );
}
