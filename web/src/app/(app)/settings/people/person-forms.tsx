'use client';

import { Check, Copy, KeyRound, Pencil, Wand2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/disclosure';
import { ActionForm } from '@/components/form-action';
import { Button, Field, Input, Select, Toggle } from '@/components/ui';
import { addPerson, generateUserPassword, makeAttendant, updatePerson } from '../actions';

/** Senha inicial aleatória, fácil de ditar (sem caracteres parecidos). */
function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

export type SectorOption = { id: string; name: string };

/** Setores da pessoa: marca/desmarca (quem é do setor vê e atende os grupos e as conversas dele). */
function SectorPicker({ sectors, value, onChange }: { sectors: SectorOption[]; value: string[]; onChange: (ids: string[]) => void }) {
  if (!sectors.length) return <p className="text-xs text-muted">Nenhum setor cadastrado (Configurações › Pessoas › Setores).</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Setores">
      {sectors.map((s) => {
        const on = value.includes(s.id);
        return (
          <button
            key={s.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== s.id) : [...value, s.id])}
            className={
              on
                ? 'inline-flex items-center gap-1 rounded-full border border-brand-line bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand-text'
                : 'inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2 hover:text-ink'
            }
          >
            {on && <Check className="h-3 w-3" />} {s.name}
          </button>
        );
      })}
    </div>
  );
}

/** Nova pessoa (0107): o mesmo cadastro para quem atende nos grupos e para quem entra no painel. */
function NewPersonForm({ onDone, sectors }: { onDone?: () => void; sectors: SectorOption[] }) {
  const [attends, setAttends] = useState(true);
  const [access, setAccess] = useState(true);
  const [password, setPassword] = useState(randomPassword);
  const [sectorIds, setSectorIds] = useState<string[]>([]);
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
                <Field label="Setores" hint="A pessoa vê e atende os grupos e as conversas privadas dos setores marcados.">
                  <SectorPicker sectors={sectors} value={sectorIds} onChange={setSectorIds} />
                </Field>
                {sectorIds.map((id) => (
                  <input key={id} type="hidden" name="sectors" value={id} />
                ))}
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

export function NewPersonDialog({ sectors = [] }: { sectors?: SectorOption[] }) {
  return (
    <FormDialog label="Nova pessoa" title="Nova pessoa" description="Quem atende nos grupos, quem entra no painel, ou os dois: um cadastro só.">
      {(close) => <NewPersonForm onDone={close} sectors={sectors} />}
    </FormDialog>
  );
}

/** Editar nome, telefone (valem para o acesso e para o atendente) e os setores de quem entra no painel. */
export function EditPerson({
  profileId,
  memberId,
  name,
  phone,
  sectors = [],
  sectorIds: initialSectors = [],
}: {
  profileId: string | null;
  memberId: string | null;
  name: string;
  phone: string | null;
  sectors?: SectorOption[];
  sectorIds?: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [n, setN] = useState(name);
  const [p, setP] = useState(phone ?? '');
  const [sectorIds, setSectorIds] = useState<string[]>(initialSectors);
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" aria-label={`Editar ${name}`} title="Editar nome, telefone e setores">
        <Pencil className="h-4 w-4" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={`Editar ${name}`}>
          <form
            className="w-full max-w-sm space-y-4 rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await updatePerson({ profileId, memberId, name: n, phone: p, sectorIds: profileId ? sectorIds : undefined });
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
            {profileId ? (
              <Field label="Setores" hint="Vê e atende os grupos e as conversas privadas dos setores marcados.">
                <SectorPicker sectors={sectors} value={sectorIds} onChange={setSectorIds} />
              </Field>
            ) : (
              <p className="text-xs text-muted">Setores valem para quem entra no painel: dê acesso a esta pessoa para escolher os setores.</p>
            )}
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

/**
 * Administrador: "Gerar nova senha" para o usuário. A senha aparece uma única vez, para copiar e passar
 * para a pessoa (depois não dá para ver de novo: é só gerar outra).
 */
export function GeneratePasswordButton({ profileId, name }: { profileId: string; name: string }) {
  const [pending, start] = useTransition();
  const [password, setPassword] = useState<string | null>(null);
  const copy = () => {
    if (!password) return;
    void navigator.clipboard?.writeText(password).then(() => toast.success('Senha copiada'));
  };
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="whitespace-nowrap"
        disabled={pending}
        title="Gerar uma senha nova para este usuário"
        onClick={() => {
          if (!confirm(`Gerar uma senha nova para ${name}?\n\nA senha atual deixa de funcionar na hora.`)) return;
          start(async () => {
            const res = await generateUserPassword(profileId);
            if (!res.ok) return void toast.error(res.error);
            setPassword(res.password);
          });
        }}
      >
        <KeyRound className="h-3.5 w-3.5" /> Nova senha
      </Button>
      {password && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Senha gerada">
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative w-full max-w-sm rounded-2xl bg-surface p-5 shadow-2xl">
            <h2 className="text-base font-semibold">Senha nova de {name}</h2>
            <p className="mt-1 text-xs text-ink-2">Copie e passe para a pessoa. Ela não será mostrada de novo; se perder, gere outra.</p>
            <div className="mt-4 flex items-center gap-2">
              <code className="flex-1 select-all rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-center font-mono text-lg tracking-wider text-ink">
                {password}
              </code>
              <Button type="button" variant="secondary" onClick={copy} aria-label="Copiar senha">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted">Recomende que a pessoa troque a senha depois do primeiro acesso.</p>
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={() => setPassword(null)}>
                Pronto
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
