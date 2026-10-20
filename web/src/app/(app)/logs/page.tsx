import { ScrollText } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';
import { requirePlatformAdmin } from '@/lib/auth';
import { cn, formatDateTime } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Monitor Group · Log' };

const PAGE = 100;
/** horário de Brasília (o servidor roda em UTC) */
const TZ = 'America/Sao_Paulo';

const PERIODS = [
  { value: 'hoje', label: 'Hoje', days: 1 },
  { value: '7d', label: '7 dias', days: 7 },
  { value: '30d', label: '30 dias', days: 30 },
  { value: '90d', label: '90 dias', days: 90 },
  { value: '180d', label: '180 dias', days: 180 },
];

const CATEGORIES: Record<string, { label: string; tone: 'neutral' | 'brand' | 'good' | 'warning' | 'critical' }> = {
  acesso: { label: 'Acesso', tone: 'neutral' },
  usuarios: { label: 'Usuários', tone: 'warning' },
  equipe: { label: 'Equipe', tone: 'warning' },
  configuracoes: { label: 'Configurações', tone: 'brand' },
  grupos: { label: 'Grupos', tone: 'brand' },
  atendimento: { label: 'Atendimento', tone: 'good' },
  demandas: { label: 'Demandas', tone: 'good' },
  alertas: { label: 'Alertas', tone: 'good' },
  empresas: { label: 'Empresas', tone: 'critical' },
};

type LogRow = {
  created_at: string;
  company_id: string | null;
  company_name: string | null;
  user_email: string | null;
  user_name: string | null;
  category: string;
  action: string;
  summary: string;
  details: { alterado?: Record<string, { de: unknown; para: unknown }> } | null;
};

const show = (v: unknown) => (v == null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

/**
 * Log de atividades dos usuários (só quem administra a plataforma): entradas e saídas do sistema,
 * mudanças de configuração, usuários e equipe, grupos, respostas enviadas, demandas e alertas.
 */
export default async function LogsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePlatformAdmin();
  const sp = await searchParams;
  const period = PERIODS.find((p) => p.value === sp.periodo) ?? PERIODS[1];
  const company = typeof sp.empresa === 'string' && sp.empresa ? sp.empresa : null;
  const category = typeof sp.tipo === 'string' && sp.tipo in CATEGORIES ? sp.tipo : null;
  const user = typeof sp.usuario === 'string' && sp.usuario.trim() ? sp.usuario.trim() : null;
  const page = Math.max(0, Number(sp.pagina ?? 0) || 0);

  const supabase = await createClient();
  const to = new Date();
  const from = new Date(to.getTime() - period.days * 86_400_000);
  if (period.value === 'hoje') from.setHours(0, 0, 0, 0);

  const [{ data, error }, { data: companies }] = await Promise.all([
    supabase.rpc('platform_activity_log', {
      p_from: from.toISOString(),
      p_to: new Date(to.getTime() + 60_000).toISOString(),
      p_company_id: company,
      p_user: user,
      p_category: category,
      p_limit: PAGE + 1,
      p_offset: page * PAGE,
    }),
    supabase.from('companies').select('id, name').order('name'),
    // retenção de 180 dias
    supabase.rpc('purge_activity_log'),
  ]);
  const rows = ((data ?? []) as LogRow[]).slice(0, PAGE);
  const hasMore = (data ?? []).length > PAGE;
  const qs = (patch: Record<string, string | number | null>) => {
    const params = new URLSearchParams();
    const base = { periodo: period.value, empresa: company, tipo: category, usuario: user, pagina: page, ...patch };
    for (const [k, v] of Object.entries(base)) if (v !== null && v !== '' && !(k === 'pagina' && v === 0)) params.set(k, String(v));
    return `/logs?${params.toString()}`;
  };
  const field = 'h-10 rounded-xl border border-line bg-surface px-3 text-sm outline-none focus:border-brand-line';

  return (
    <div>
      <PageHeader
        title="Log"
        description="Principais registros dos usuários de todas as empresas: entradas no sistema, mudanças de configuração, usuários e equipe, grupos, respostas enviadas, demandas e alertas. Visível só para quem administra a plataforma; guardado por 180 dias."
      />

      <Card className="mb-4 p-3 sm:p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]" action="/logs">
          <select name="periodo" defaultValue={period.value} className={field} aria-label="Período">
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select name="empresa" defaultValue={company ?? ''} className={field} aria-label="Empresa">
            <option value="">Todas as empresas</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select name="tipo" defaultValue={category ?? ''} className={field} aria-label="Tipo de registro">
            <option value="">Todos os tipos</option>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
          <input name="usuario" defaultValue={user ?? ''} placeholder="Usuário (nome ou e-mail)" className={field} aria-label="Usuário" />
          <button className="h-10 rounded-xl bg-brand px-4 text-sm font-medium text-brand-ink hover:opacity-90">Filtrar</button>
        </form>
      </Card>

      <Card>
        {error ? (
          <EmptyState
            icon={<ScrollText />}
            title="Não foi possível carregar o log"
            description={/platform_activity_log/.test(error.message) ? 'Execute o supabase/atualizar_banco.sql no Supabase.' : error.message}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={<ScrollText />} title="Nenhum registro" description="Nada com esses filtros no período." />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r, i) => {
              const cat = CATEGORIES[r.category] ?? { label: r.category, tone: 'neutral' as const };
              const changes = r.details?.alterado ? Object.entries(r.details.alterado) : [];
              return (
                <li key={`${r.created_at}-${i}`} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:gap-4 sm:px-5">
                  <span className="tabular w-36 shrink-0 text-xs text-muted">{formatDateTime(r.created_at, TZ)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-ink">{r.summary}</p>
                    <p className="mt-0.5 text-xs text-ink-2">
                      <strong className="font-medium">{r.user_name || r.user_email || 'Usuário'}</strong>
                      {r.user_email && r.user_name !== r.user_email ? ` · ${r.user_email}` : ''}
                      {r.company_name ? ` · ${r.company_name}` : ''}
                    </p>
                    {changes.length > 0 && (
                      <details className="mt-1 text-xs text-ink-2">
                        <summary className="cursor-pointer text-muted hover:text-ink">ver o que mudou ({changes.length})</summary>
                        <ul className="mt-1 space-y-0.5 rounded-lg bg-surface-2/60 p-2 font-mono text-[11px]">
                          {changes.map(([k, v]) => (
                            <li key={k} className="break-all">
                              <span className="text-ink">{k}</span>: {show(v.de).slice(0, 120)} → {show(v.para).slice(0, 120)}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                  <Badge tone={cat.tone} className="self-start">
                    {cat.label}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
        {(page > 0 || hasMore) && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-sm sm:px-5">
            <Link href={qs({ pagina: page - 1 })} className={cn('text-brand-text hover:underline', page === 0 && 'pointer-events-none opacity-40')}>
              ← Mais recentes
            </Link>
            <span className="text-xs text-muted">Página {page + 1}</span>
            <Link href={qs({ pagina: page + 1 })} className={cn('text-brand-text hover:underline', !hasMore && 'pointer-events-none opacity-40')}>
              Mais antigos →
            </Link>
          </div>
        )}
      </Card>
    </div>
  );
}
