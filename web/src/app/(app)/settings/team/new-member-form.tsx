'use client';

import { ActionForm } from '@/components/form-action';
import { Button, Field, Input } from '@/components/ui';
import { addTeamMember } from '../actions';

export function NewMemberForm() {
  return (
    <ActionForm action={addTeamMember} success="Atendente adicionado" resetOnSuccess className="space-y-4">
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
