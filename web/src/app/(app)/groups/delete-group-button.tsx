'use client';

import { Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui';
import { deleteGroupsAsPlatform } from './delete-actions';

/** "Excluir grupo" (só o administrador geral): apaga o grupo e as mensagens dele do sistema. */
export function DeleteGroupButton({ groupId, name, active }: { groupId: string; name: string; active: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      className="text-critical-ink"
      title="Excluir este grupo e todas as mensagens dele do sistema"
      onClick={() => {
        const warn = active
          ? '\n\nO número conectado ainda participa deste grupo: ele volta a aparecer (vazio) quando chegar uma nova mensagem. Para parar de monitorar sem apagar, desligue "Monitorar este grupo".'
          : '';
        if (!window.confirm(`Excluir o grupo "${name}" do sistema?\n\nAs mensagens, alertas e demandas ligadas a ele são apagados e não dá para desfazer.${warn}`)) return;
        start(async () => {
          const res = await deleteGroupsAsPlatform([groupId]);
          if (!res.ok) return void toast.error(res.error);
          toast.success('Grupo excluído');
          router.replace('/groups');
        });
      }}
    >
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Excluir grupo
    </Button>
  );
}
