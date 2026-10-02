'use client';

import { useRouter } from 'next/navigation';
import { useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';

/** Formulário que envia para uma Server Action e mostra o resultado. */
export function ActionForm({
  action,
  children,
  success = 'Salvo com sucesso',
  className,
  resetOnSuccess,
  onDone,
}: {
  action: (form: FormData) => Promise<{ ok: boolean; error?: string }>;
  children: (pending: boolean) => ReactNode;
  success?: string;
  className?: string;
  resetOnSuccess?: boolean;
  onDone?: () => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const formEl = e.currentTarget;
        const data = new FormData(formEl);
        start(async () => {
          const res = await action(data);
          if (!res.ok) {
            toast.error(res.error ?? 'Erro ao salvar');
            return;
          }
          toast.success(success);
          if (resetOnSuccess) formEl.reset();
          onDone?.();
          router.refresh();
        });
      }}
    >
      {children(pending)}
    </form>
  );
}
