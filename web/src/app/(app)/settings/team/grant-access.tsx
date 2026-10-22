'use client';

import { KeyRound, Wand2, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button, Field, Input, Select } from '@/components/ui';
import { grantTeamMemberAccess } from '../actions';

/** Senha inicial aleatória, fácil de ditar (sem caracteres parecidos). */
function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const buf = new Uint32Array(10);
  crypto.getRandomValues(buf);
  return Array.from(buf, (n) => chars[n % chars.length]).join('');
}

/**
 * Administrador: transforma a pessoa da equipe em usuário do sistema (e-mail + senha inicial),
 * já com o nome dela. Depois disso ela entra no painel com o perfil escolhido.
 */
export function GrantAccess({ member }: { member: { id: string; name: string; user_email?: string | null } }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'agent' | 'viewer' | 'admin'>('agent');
  const [password, setPassword] = useState('');
  const [pending, start] = useTransition();

  // já tem acesso: o e-mail aparece na linha da pessoa
  if (member.user_email) return null;

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setPassword(randomPassword());
          setOpen(true);
        }}
      >
        <KeyRound className="h-3.5 w-3.5" /> Dar acesso
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={`Acesso de ${member.name}`}>
          <div className="w-full max-w-md rounded-t-2xl bg-surface p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold">Dar acesso ao sistema</p>
                <p className="mt-0.5 text-xs text-ink-2">
                  <strong>{member.name}</strong> passa a entrar no painel com este e-mail e a senha inicial.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                start(async () => {
                  const res = await grantTeamMemberAccess({ memberId: member.id, email, role, password });
                  if (!res.ok) return void toast.error(res.error);
                  toast.success(`Acesso criado para ${member.name}`, {
                    description: `E-mail: ${email.trim().toLowerCase()} · senha inicial: ${password} (passe para a pessoa)`,
                    duration: 30_000,
                  });
                  setOpen(false);
                });
              }}
            >
              <Field label="E-mail de acesso">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="pessoa@empresa.com" autoFocus />
              </Field>
              <Field label="Perfil">
                <Select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  <option value="agent">Atendente - atende os grupos do setor</option>
                  <option value="viewer">Somente ver painéis - acompanha sem alterar nada</option>
                  <option value="admin">Administrador - acesso total</option>
                </Select>
              </Field>
              <Field label="Senha inicial" hint="Já vem uma senha gerada; troque se quiser. A pessoa pode mudar depois em “Esqueci minha senha”.">
                <div className="flex gap-2">
                  <Input value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
                  <Button type="button" variant="secondary" onClick={() => setPassword(randomPassword())} title="Gerar outra senha">
                    <Wand2 className="h-4 w-4" />
                  </Button>
                </div>
              </Field>
              <div className="flex gap-2">
                <Button disabled={pending} className="flex-1">
                  {pending ? 'Criando acesso…' : 'Criar acesso'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
