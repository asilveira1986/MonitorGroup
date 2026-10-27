'use client';

import { Pencil, Wand2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/disclosure';
import { ActionForm } from '@/components/form-action';
import { Button, Field, Input, Select, Toggle } from '@/components/ui';
import { addPerson, makeAttendant, updatePerson } from '../actions';

/** Senha inicial aleatória, fácil de ditar (sem caracteres parecidos). */
function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

/** Nova pessoa (0107): o mesmo cadastro para quem atende nos grupos e para quem entra no painel. */
function NewPersonForm({ onDone }: { onDone?: () => void }) {
  const [attends, setAttends] = useState(true);
  const [access, setAccess] = useState(true);
  const [password, setPassword] = useState(randomPassword);
  return (
    <ActionForm action={addPerson} success="Pessoa cadastrada" onDone={onDone} className="space-y-4">
      {(pending) => (
        <>
          <Field label="Nome">
            <Input name="name" required maxLength={120} placeholder="Nome da pessoa" autoFocus />
          </Field>
          <Field label="WhatsApp (com DDD)" hint="Identifica as mensagens dela nos grupos e recebe os avisos no WhatsApp.">
            <Input name="phone" inputMode="tel" placeholder="51 99999-8888" required={attends} />
          </Field>
          <div className="space-y-3 rounded-xl border border-line p-3">
            <Toggle checked={attends} onChange={setAttends} label="Atende nos grupos (é da equipe)" />
            <input type="hidden" name="attends" value={attends ? 'on' : ''} />
            <Toggle checked={access} onChange={setAccess} label="Entra no painel (tem login)" />
            <input type="hidden" name="access" value={access ? 'on' : ''} />
            {access && (
              <div className="space-y-3 border-t border-line pt-3">
                <Field label="E-mail de acesso">
                  <Input name="email" type="email" required placeholder="pessoa@empresa.com" />
                </Field>
                <Field label="Perfil">
                  <Select name="role" defaultValue="agent">
                    <option value="agent">Atendente - atende os grupos do setor</option>
                    <option value="viewer">Somente ver painéis - acompanha sem alterar nada</option>
                    <option value="agenda">Só agenda - usa apenas a Agenda (compromissos)</option>
                    <option value="admin">Administrador - acesso total</option>
                  </Select>
                </Field>
                <Field label="Senha inicial" hint="Já vem uma senha gerada; passe para a pessoa. Ela pode trocar depois.">
                  <div className="flex gap-2">
                    <Input name="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
                    <Button type="button" variant="secondary" onClick={() => setPassword(randomPassword())} title="Gerar outra senha">
                      <Wand2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Field>
              </div>
            )}
          </div>
          <Button disabled={pending} className="w-full">
            {pending ? 'Cadastrando…' : 'Cadastrar'}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function NewPersonDialog() {
  return (
    <FormDialog label="Nova pessoa" title="Nova pessoa" description="Quem atende nos grupos, quem entra no painel, ou os dois: um cadastro só.">
      {(close) => <NewPersonForm onDone={close} />}
    </FormDialog>
  );
}

/** Editar nome e telefone (valem para o acesso e para o atendente). */
export function EditPerson({ profileId, memberId, name, phone }: { profileId: string | null; memberId: string | null; name: string; phone: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(name);
  const [p, setP] = useState(phone ?? '');
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label={`Editar ${name}`} title="Editar nome e telefone">
        <Pencil className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={`Editar ${name}`}>
          <form
            className="w-full max-w-sm space-y-4 rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await updatePerson({ profileId, memberId, name: n, phone: p });
                if (!res.ok) return void toast.error(res.error);
                toast.success('Pessoa atualizada');
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-base font-semibold">Editar pessoa</p>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <Field label="Nome">
              <Input value={n} onChange={(e) => setN(e.target.value)} required maxLength={120} autoFocus />
            </Field>
            <Field label="WhatsApp (com DDD)">
              <Input value={p} onChange={(e) => setP(e.target.value)} inputMode="tel" placeholder="51 99999-8888" required={Boolean(memberId)} />
            </Field>
            <div className="flex gap-2">
              <Button disabled={pending} className="flex-1">
                {pending ? 'Salvando…' : 'Salvar'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

/** Quem só entra no painel passa a atender nos grupos. */
export function MakeAttendantButton({ profileId }: { profileId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="whitespace-nowrap"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await makeAttendant(profileId);
          if (!res.ok) return void toast.error(res.error);
          toast.success('Agora atende nos grupos');
          router.refresh();
        })
      }
    >
      + Atende nos grupos
    </Button>
  );
}
