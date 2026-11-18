'use client';

import { useState } from 'react';
import { Badge, Card, Input, Select } from '@/components/ui';
import { cn, timeAgo } from '@/lib/format';
import { isOnline, mutedKinds, notificationState, STATE_LABEL, type NotificationRow, type NotificationState } from '@/lib/notification-status';

const TONE = { ok: 'good', screen: 'warning', failing: 'critical', off: 'critical' } as const;
const STATES: NotificationState[] = ['ok', 'screen', 'failing', 'off'];

export function NotificationList({ rows }: { rows: NotificationRow[] }) {
  const [q, setQ] = useState('');
  const [state, setState] = useState<'' | NotificationState>('');
  const [now] = useState(() => Date.now());
  const items = rows.map((r) => ({ r, s: notificationState(r) }));
  const counts = Object.fromEntries(STATES.map((s) => [s, items.filter((i) => i.s === s).length])) as Record<NotificationState, number>;
  const term = q.trim().toLowerCase();
  const shown = items.filter(
    (i) => (!state || i.s === state) && (!term || `${i.r.name} ${i.r.email} ${i.r.company_name ?? ''}`.toLowerCase().includes(term)),
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STATES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(state === s ? '' : s)}
            className={cn('rounded-xl border px-3 py-2 text-left transition', state === s ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2')}
          >
            <p className="tabular text-lg font-bold">{counts[s]}</p>
            <p className="text-xs text-ink-2">{STATE_LABEL[s]}</p>
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, e-mail ou empresa" className="sm:max-w-sm" />
        <Select value={state} onChange={(e) => setState(e.target.value as '' | NotificationState)} className="sm:w-56">
          <option value="">Todas as situações</option>
          {STATES.map((s) => (
            <option key={s} value={s}>
              {STATE_LABEL[s]}
            </option>
          ))}
        </Select>
      </div>
      <Card>
        <ul className="divide-y divide-line">
          {shown.map(({ r, s }) => {
            const muted = mutedKinds(r.push_prefs);
            return (
              <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-sm font-medium">
                    <span className={cn('size-2 shrink-0 rounded-full', isOnline(r.last_seen_at, now) ? 'bg-good' : 'bg-muted/50')} title={isOnline(r.last_seen_at, now) ? 'Com o sistema aberto agora' : 'Sistema fechado'} />
                    {r.name}
                  </p>
                  <p className="truncate text-xs text-ink-2">
                    {r.email}
                    {r.company_name ? ` · ${r.company_name}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-2 sm:w-[28rem] sm:justify-end">
                  <Badge tone={TONE[s]}>{STATE_LABEL[s]}</Badge>
                  <span>
                    {r.devices > 0 ? `${r.devices_ok}/${r.devices} aparelho${r.devices > 1 ? 's' : ''} com push` : 'sem push'}
                    {r.last_push_ok_at ? ` · último push ${timeAgo(r.last_push_ok_at)}` : ''}
                  </span>
                  <span>· acesso {r.last_seen_at ? timeAgo(r.last_seen_at) : 'nunca'}</span>
                  {muted.length > 0 && <span className="text-warning-ink">· desligou: {muted.join(', ')}</span>}
                </div>
              </li>
            );
          })}
          {shown.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">Nenhum usuário nesse filtro.</li>}
        </ul>
      </Card>
      <p className="text-xs text-muted">
        &quot;Só com o sistema aberto&quot;: o usuário não ativou o push neste ou em nenhum aparelho. O som e o alerta em tela dependem da permissão do navegador, que o
        sistema não consegue ver daqui.
      </p>
    </div>
  );
}
