'use client';

import { Loader2, PackageCheck, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { deliverDemand } from '@/app/(app)/demands/actions';
import { Button, Textarea } from '@/components/ui';

/**
 * "Demanda entregue": confirma a entrega com uma observação opcional, que vai no aviso de
 * conclusão para o cliente no grupo (0092).
 */
export function DeliverButton({ id, number, size, onDone }: { id: string; number: number; size?: 'sm'; onDone?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);
  const confirmDelivery = () =>
    start(async () => {
      const res = await deliverDemand(id, note);
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Demanda #${number} entregue`, { description: 'O cliente recebe o aviso de conclusão no grupo.' });
      setOpen(false);
      setNote('');
      onDone?.();
      router.refresh();
    });
  return (
    <>
      <Button size={size} disabled={pending} onClick={() => setOpen(true)}>
        <PackageCheck className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} /> Demanda entregue
      </Button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Entregar a demanda #${number}`}>
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <div className="relative w-full max-w-md space-y-4 rounded-t-2xl bg-surface p-5 text-ink shadow-2xl sm:rounded-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Entregar a demanda #{number}</h2>
                  <p className="mt-0.5 text-xs text-ink-2">O cliente recebe no grupo o aviso de que a demanda foi concluída.</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-2">Observação para o cliente (opcional)</span>
                <Textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={4}
                  maxLength={1000}
                  autoFocus
                  placeholder="Ex.: Boleto enviado para o e-mail do financeiro, com vencimento no dia 05."
                />
              </label>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button onClick={confirmDelivery} disabled={pending}>
                  {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Confirmar entrega
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
