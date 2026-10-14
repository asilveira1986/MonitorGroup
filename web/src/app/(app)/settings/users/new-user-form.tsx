'use client';

import { ActionForm } from '@/components/form-action';
import { Button, Field, Input, Select } from '@/components/ui';
import { addAllowedEmail } from '../actions';

export function NewUserForm() {
  return (
    <ActionForm action={addAllowedEmail} success="Usuário cadastrado" resetOnSuccess className="space-y-4">
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
              <option value="agent">Atendente - vê painéis e responde alertas</option>
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
