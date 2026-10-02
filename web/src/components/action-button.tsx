'use client';

import { Loader2 } from 'lucide-react';
import { useTransition, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';

/** Botão que executa uma Server Action e mostra o resultado. */
export function ActionButton({
  action,
  children,
  success,
  confirm,
  variant = 'secondary',
  size = 'sm',
  className,
}: {
  action: () => Promise<{ ok: boolean; error?: string }>;
  children: ReactNode;
  success?: string;
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const res = await action();
          if (!res.ok) toast.error(res.error ?? 'Erro ao salvar');
          else if (success) toast.success(success);
        });
      }}
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </Button>
  );
}
