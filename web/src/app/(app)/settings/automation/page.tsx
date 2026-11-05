import { AlertTriangle } from 'lucide-react';
import type { Metadata } from 'next';
import { AdminNotice } from '@/components/admin-notice';
import { Card, EmptyState } from '@/components/ui';
import { requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { AutomationPanel, type AutomationMetrics, type MemberOption, type PendingItem, type RuleItem } from './automation-panel';

export const metadata: Metadata = { title: 'Monitor Group · Automação de atendimento' };

/**
 * Atendimento › Automação de atendimento: acuse de recebimento no grupo do cliente, alerta em tela, aviso e
 * cobrança no grupo interno enquanto a mensagem do cliente ficar sem resposta (0144).
 */
export default async function AutomationPage() {
  const profile = await requireProfile();
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  const [settings, rules, pending, metrics, groups, team] = await Promise.all([
    // sem o script do banco (0145) a coluna não existe: a chave geral aparece desligada
    supabase.from('app_settings').select('*').maybeSingle(),
    supabase.from('automation_rules').select('*, groups(name)').order('created_at'),
    supabase.from('automation_pending').select('*, groups(name)').is('resolved_at', null).order('received_at'),
    supabase.rpc('automation_metrics', { p_days: 30 }),
    supabase.from('groups').select('id, name, jid').is('removed_at', null).order('name'),
    supabase.from('team_members').select('id, name, phone, jid').eq('active', true).order('name'),
  ]);

  // sem o script do banco (0144) as tabelas não existem
  if (rules.error) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle />}
          title="Falta atualizar o banco de dados"
          description="Rode no SQL Editor do Supabase o script supabase/atualizar_banco_parte2.sql (item 0144) e recarregue esta página."
        />
      </Card>
    );
  }

  const members: MemberOption[] = ((team.data ?? []) as { id: string; name: string; phone: string | null; jid: string | null }[])
    .map((m) => ({ id: m.id, name: m.name, jid: m.jid ?? (m.phone ? `${m.phone}@s.whatsapp.net` : null) }))
    .filter((m): m is MemberOption => Boolean(m.jid));

  return (
    <div className="space-y-4">
      {!isAdmin && <AdminNotice />}
      <AutomationPanel
        isAdmin={isAdmin}
        enabled={Boolean((settings.data as { automation_enabled?: boolean } | null)?.automation_enabled)}
        rules={(rules.data ?? []) as unknown as RuleItem[]}
        pending={(pending.data ?? []) as unknown as PendingItem[]}
        metrics={(metrics.data ?? null) as AutomationMetrics | null}
        groups={(groups.data ?? []) as { id: string; name: string; jid: string }[]}
        members={members}
      />
    </div>
  );
}
