import { BellRing, MonitorUp, Speech } from 'lucide-react';
import Link from 'next/link';
import { AdminNotice } from '@/components/admin-notice';
import { requireProfile } from '@/lib/auth';
import { cn } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import type { AlertRule, AppSettings } from '@/lib/types';
import type { VoiceEvent } from '@/lib/voice';
import { MessageAlertSettings } from '../message-alert-settings';
import { RulesPanel } from './rules';
import { VoiceSettings } from './voice-settings';

const SECTIONS = [
  { key: 'regras', label: 'Regras', icon: BellRing, hint: 'Quando o sistema cria um alerta e por onde avisa.' },
  { key: 'tela', label: 'Avisos em tela', icon: MonitorUp, hint: 'O aviso grande no centro da tela, o tempo e o som.' },
  { key: 'voz', label: 'Aviso por voz', icon: Speech, hint: 'O que é falado, a voz, a velocidade e o tom.' },
] as const;
type Section = (typeof SECTIONS)[number]['key'];

/** Tudo de alertas num lugar só: regras, avisos em tela e aviso por voz. */
export default async function AlertRulesPage({ searchParams }: PageProps<'/settings/alerts'>) {
  const profile = await requireProfile();
  const raw = (await searchParams).secao;
  const section: Section = SECTIONS.some((s) => s.key === raw) ? (raw as Section) : 'regras';
  const isAdmin = profile.role === 'admin' || profile.platform_admin;
  const supabase = await createClient();
  const [{ data: rules }, { data: groups }, { data: settings }] = await Promise.all([
    supabase.from('alert_rules').select('*').order('created_at'),
    supabase.from('groups').select('id, name').eq('monitored', true).is('removed_at', null).order('name'),
    supabase.from('app_settings').select('*').maybeSingle(),
  ]);
  const list = (rules ?? []) as AlertRule[];
  const s = settings as AppSettings | null;

  return (
    <>
      {!isAdmin && <AdminNotice />}
      <nav aria-label="Seções de alertas" className="mb-4 grid gap-2 sm:grid-cols-3">
        {SECTIONS.map((x) => (
          <Link
            key={x.key}
            href={x.key === 'regras' ? '/settings/alerts' : `/settings/alerts?secao=${x.key}`}
            aria-current={section === x.key ? 'page' : undefined}
            className={cn(
              'flex items-start gap-3 rounded-2xl border p-3 transition',
              section === x.key ? 'border-brand-line bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2',
            )}
          >
            <x.icon className={cn('mt-0.5 h-5 w-5 shrink-0', section === x.key ? 'text-brand-text' : 'text-muted')} aria-hidden />
            <span>
              <span className="block text-sm font-semibold">{x.label}</span>
              <span className="block text-xs text-ink-2">{x.hint}</span>
            </span>
          </Link>
        ))}
      </nav>

      {section === 'regras' && <RulesPanel rules={list} groups={groups ?? []} isAdmin={isAdmin} />}
      {section === 'tela' && s && <MessageAlertSettings settings={s} disabled={!isAdmin} />}
      {section === 'voz' && (
        <VoiceSettings
          initial={{
            voice: s?.msg_alert_voice ?? true,
            messages: s?.msg_alert_voice_messages ?? true,
            sla: s?.msg_alert_voice_sla ?? true,
            templates: (s?.msg_alert_voice_templates ?? {}) as Partial<Record<VoiceEvent, string>>,
            voiceName: s?.msg_alert_voice_name ?? null,
            rate: Number(s?.msg_alert_voice_rate ?? 1),
            pitch: Number(s?.msg_alert_voice_pitch ?? 1),
          }}
          disabled={!isAdmin}
          rulesWithVoice={list.filter((r) => r.voice !== false).length}
          rulesTotal={list.length}
        />
      )}
    </>
  );
}
