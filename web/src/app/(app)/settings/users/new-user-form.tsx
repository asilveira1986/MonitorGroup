'use client';

import { FormDialog } from '@/components/disclosure';
import { ActionForm } from '@/components/form-action';
import { Button, Field, Input, Select } from '@/components/ui';
import { addAllowedEmail } from '../actions';

export function NewUserForm({ onDone }: { onDone?: () => void }) {
  return (
    <ActionForm action={addAllowedEmail} success="Usuário cadastrado" resetOnSuccess onDone={onDone} className="space-y-4">
      {(pending) => (
        <>
          <Field label="Nome">
            <Input name="full_name" placeholder="Nome do usuário" />
          </Field>
          <Field label="E-mail">
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
          <Field label="Senha inicial" hint="A pessoa entra com este e-mail e esta senha e pode trocá-la em “Esqueci minha senha”.">
            <Input name="password" type="password" required minLength={8} autoComplete="new-password" placeholder="mínimo 8 caracteres" />
          </Field>
          <Button disabled={pending} className="w-full">
            {pending ? 'Cadastrando…' : 'Cadastrar'}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

/** "Novo acesso": o formulário abre só ao clicar. */
export function NewUserDialog() {
  return (
    <FormDialog label="Novo acesso" title="Novo acesso ao painel" description="A pessoa entra com este e-mail e a senha inicial.">
      {(close) => <NewUserForm onDone={close} />}
    </FormDialog>
  );
}
