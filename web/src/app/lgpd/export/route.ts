import type { NextRequest } from 'next/server';
import { requirePlatformAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Pedido do titular (LGPD): todos os dados da pessoa (pelo telefone) num arquivo JSON, para entregar
 * a ela. Só o administrador geral do sistema (conferido no banco); a exportação fica no log de atividades.
 */
export async function GET(request: NextRequest) {
  await requirePlatformAdmin();
  const phone = request.nextUrl.searchParams.get('phone') ?? '';
  const { data, error } = await (await createClient()).rpc('lgpd_person_export', { p_phone: phone });
  if (error) return new Response(error.message, { status: 403 });
  const digits = phone.replace(/\D/g, '');
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="dados-pessoais-${digits.slice(-4)}-${new Date().toISOString().slice(0, 10)}.json"`,
      'cache-control': 'no-store',
    },
  });
}
