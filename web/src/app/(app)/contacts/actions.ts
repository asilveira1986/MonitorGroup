'use server';

import { revalidatePath } from 'next/cache';
import { requireProfile } from '@/lib/auth';
import { friendlyDbError } from '@/lib/db-errors';
import { createClient } from '@/lib/supabase/server';

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export type ContactInput = {
  name: string;
  phone: string;
  email: string;
  organization: string;
  notes: string;
  tags: string[];
};

/** Novo contato ou edição (0112). Contato só da agenda do WhatsApp: cria o cadastro dele no sistema. */
export async function saveContact(id: string | null, input: ContactInput): Promise<Result<{ id: string }>> {
  await requireProfile();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('save_contact', {
    p_id: id,
    p_name: input.name,
    p_phone: input.phone || null,
    p_email: input.email || null,
    p_organization: input.organization || null,
    p_notes: input.notes || null,
    p_tags: input.tags,
  });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/contacts');
  revalidatePath('/private');
  return { ok: true, data: { id: data as string } };
}

/** Exclui o cadastro do sistema (o contato da agenda do WhatsApp e as conversas continuam). */
export async function deleteContact(id: string): Promise<Result> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_contact', { p_id: id });
  if (error) return { ok: false, error: friendlyDbError(error.message) };
  revalidatePath('/contacts');
  return { ok: true };
}
