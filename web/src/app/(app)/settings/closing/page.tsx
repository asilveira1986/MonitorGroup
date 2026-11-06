import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { AdminNotice } from '@/components/admin-notice';
import { Card, EmptyState } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { ClosingPanel, type ClosingFlowItem, type ClosingMetrics, type SurveyItem } from './closing-panel';

export const metadata: Metadata = { title: 'Monitor Group · Mensagem de encerramento' };

/**
 * Atendimento › Mensagem de encerramento: depois que a equipe encerra o atendimento, o cliente recebe uma enquete
 * (o "botão" de resposta) e o sistema age conforme a escolha: responde, avisa o grupo interno ou reabre (0149).
 */
export default async function ClosingPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  const [flows, surveys, metrics, groups, sectors, team] = await Promise.all([
    supabase.from('closing_flows').select('*').order('created_at'),
    supabase
      .from('closing_surveys')
      .select('id, status, answer_label, answered_by, answered_at, sent_at, send_at, groups(name)')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.rpc('closing_metrics', { p_days: 30 }),
    supabase.from('groups').select('id, name, jid, sector_id').is('removed_at', null).order('name'),
    supabase.from('sectors').select('id, name').order('name'),
    supabase.from('team_members').select('id, name, phone, jid').eq('active', true).order('name'),
  ]);

  // sem o script do banco (0149) as tabelas não existem
  if (flows.error) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle />}
          title="Falta atualizar o banco de dados"
          description="Rode no SQL Editor do Supabase o script supabase/atualizar_banco_parte2.sql (item 0149) e recarregue esta página."
        />
      </Card>
    );
  }

  const members = ((team.data ?? []) as { id: string; name: string; phone: string | null; jid: string | null }[])
    .map((m) => ({ id: m.id, name: m.name, jid: m.jid ?? (m.phone ? `${m.phone}@s.whatsapp.net` : null) }))
    .filter((m): m is { id: string; name: string; jid: string } => Boolean(m.jid));

  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <ClosingPanel
        isAdmin={isAdmin}
        flows={(flows.data ?? []) as unknown as ClosingFlowItem[]}
        surveys={(surveys.data ?? []) as unknown as SurveyItem[]}
        metrics={(metrics.data ?? null) as ClosingMetrics | null}
        groups={(groups.data ?? []) as { id: string; name: string; jid: string; sector_id: string | null }[]}
        sectors={(sectors.data ?? []) as { id: string; name: string }[]}
        members={members}
      />
    </div>
  );
}
