'use client';

import { Pencil, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { CustomerTag } from '@/components/customer-tags';
import { createClient } from '@/lib/supabase/client';
import { ContactDialog, type Contact } from '../contacts/contacts-book';

/** O mesmo número com e sem o 9 do celular (55 + DDD + 9 + 8 dígitos). */
function phoneVariants(phone: string): string[] {
  const d = phone.replace(/\D/g, '');
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}\d{8}$/.test(d)) return [d, `${d.slice(0, 4)}9${d.slice(4)}`];
  return [d];
}

/**
 * Na conversa privada: "Adicionar contato" quando o número ainda não está cadastrado no sistema
 * (Contatos, 0112), ou "Editar contato" quando já está.
 */
export function SaveContactButton({
  chat,
  tags,
}: {
  chat: { jid: string; phone: string | null; name: string | null; tags?: string[] };
  tags: CustomerTag[];
}) {
  // undefined = ainda procurando; null = não cadastrado
  const [saved, setSaved] = useState<Contact | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    if (!chat.phone) return;
    void createClient()
      .from('contacts')
      .select('id, name, phone, email, organization, notes, tags')
      .in('phone', phoneVariants(chat.phone))
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setSaved(data ? ({ ...data, jid: chat.jid, notify: null } as Contact) : null));
  }, [chat.phone, chat.jid]);
  useEffect(load, [load]);

  // sem número (só o identificador do WhatsApp): nada cadastrado ainda
  const current = chat.phone ? saved : null;
  if (current === undefined) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] font-medium text-ink-2 hover:border-brand-line hover:text-ink"
        title={current ? 'Editar o contato cadastrado no sistema' : 'Cadastrar este número nos Contatos do sistema'}
      >
        {current ? <Pencil className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />} {current ? 'Editar contato' : 'Adicionar contato'}
      </button>
      {open && (
        <ContactDialog
          heading={current ? 'Editar contato' : 'Adicionar contato'}
          contact={
            current ?? { jid: chat.jid, phone: chat.phone, name: chat.name && /\p{L}/u.test(chat.name) ? chat.name : null, notify: null, tags: chat.tags ?? [] }
          }
          tags={tags}
          onClose={() => setOpen(false)}
          onSaved={load}
        />
      )}
    </>
  );
}
