'use client';

import { FormDialog } from '@/components/disclosure';
import { ActionForm } from '@/components/form-action';
import { Button, Field, Input } from '@/components/ui';
import { addTeamMember } from '../actions';

export function NewMemberForm({ onDone }: { onDone?: () => void }) {
  return (
    <ActionForm action={addTeamMember} success="Atendente adicionado" resetOnSuccess onDone={onDone} className="space-y-4">
      {(pending) => (
        <>
          <Field label="Nome">
            <Input name="name" required placeholder="Maria - Suporte" />
          </Field>
          <Field label="WhatsApp" hint="Com DDI e DDD. Ex.: 5511999998888">
            <Input name="phone" required inputMode="tel" placeholder="5511999998888" />
          </Field>
          <Button disabled={pending} className="w-full">
            Adicionar
          </Button>
        </>
      )}
    </ActionForm>
  );
}

/** "Adicionar atendente": o formulário abre só ao clicar. */
export function NewMemberDialog() {
  return (
    <FormDialog
      label="Adicionar atendente"
      title="Adicionar atendente"
      description="Quem responde nos grupos pelo próprio celular. As mensagens do número conectado já contam como equipe."
    >
      {(close) => <NewMemberForm onDone={close} />}
    </FormDialog>
  );
}
