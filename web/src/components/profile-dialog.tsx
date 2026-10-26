'use client';

import { Loader2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { prepareMyPhoto, saveMyPhoto, updateMyProfile } from '@/app/(app)/profile/actions';
import { ImageUpload } from '@/components/image-upload';
import { PushSettings } from '@/components/push-settings';
import { Button, Field, Input } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

export type MyProfile = { id: string; name: string; email: string; phone: string | null; initials: string; photoSrc: string | null; role?: string };

/**
 * Meu perfil (0085): o bloco do usuário no menu lateral abre a janela para editar nome, telefone,
 * foto e senha, e ativar as notificações push neste aparelho (0098). A janela vai para o fim da página (fora do menu, que usa o tema escuro).
 */
export function ProfileDialog({ me, children, className }: { me: MyProfile; children: ReactNode; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open]);

  const save = () =>
    start(async () => {
      const res = await updateMyProfile({ name, phone });
      if (!res.ok) return void toast.error(res.error);
      if (password) {
        if (password.length < 8) return void toast.error('A senha nova precisa de pelo menos 8 caracteres.');
        if (password !== confirm) return void toast.error('A confirmação não bate com a senha nova.');
        const { error } = await createClient().auth.updateUser({ password });
        if (error) return void toast.error('Não foi possível trocar a senha', { description: error.message });
        setPassword('');
        setConfirm('');
      }
      toast.success('Perfil salvo');
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} title="Meu perfil">
        {children}
      </button>
      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label="Meu perfil">
            <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
            <form
              className="relative max-h-[92dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-surface p-5 text-ink shadow-2xl sm:rounded-2xl"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">Meu perfil</h2>
                  <p className="mt-0.5 text-xs text-ink-2">{me.email}</p>
                </div>
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-1 text-muted hover:text-ink" aria-label="Fechar">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <ImageUpload
                round
                size="h-16 w-16"
                label="Enviar foto"
                src={me.photoSrc}
                prepare={prepareMyPhoto}
                save={saveMyPhoto}
                fallback={
                  <span className="flex h-full w-full items-center justify-center bg-gradient-to-br from-brand to-[#8fc41a] text-sm font-bold text-brand-ink">
                    {me.initials}
                  </span>
                }
              />
              <Field label="Nome">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
              </Field>
              <Field label="Telefone (com DDD)">
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="51 99999-8888" />
              </Field>
              <PushSettings userId={me.id} agendaOnly={me.role === 'agenda'} />
              <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
                <Field label="Senha nova (opcional)">
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} />
                </Field>
                <Field label="Confirmar a senha">
                  <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" disabled={!password} />
                </Field>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                  Cancelar
                </Button>
                <Button disabled={pending}>
                  {pending && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
                </Button>
              </div>
            </form>
          </div>,
          document.body,
        )}
    </>
  );
}
