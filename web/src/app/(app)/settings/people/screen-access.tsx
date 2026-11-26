'use client';

import { Lock, RotateCcw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { saveScreenAccess } from '@/app/(app)/settings/actions/users';
import { Badge, Button } from '@/components/ui';
import { LOCK_REASON, type ScreenLock } from '@/lib/screens';

export type ScreenRow = {
  href: string;
  label: string;
  description: string;
  section: string;
  /** tela fixa: não se configura por pessoa */
  locked: ScreenLock | null;
  /** a pessoa tem acesso agora */
  allowed: boolean;
  /** o padrão do perfil dela (sem a escolha pessoal) */
  defaultAllowed: boolean;
};

/**
 * Telas do sistema e o que a pessoa tem acesso: o administrador marca ou desmarca cada uma só para ela. O que difere do padrão do
 * perfil fica "personalizado". Telas fixas (só administradores, só da plataforma) aparecem, mas não se mudam.
 */
export function ScreenAccessForm({ userId, name, roleLabel, rows }: { userId: string; name: string; roleLabel: string; rows: ScreenRow[] }) {
  const router = useRouter();
  const [checked, setChecked] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.href, r.allowed])));
  const [saved, setSaved] = useState<Record<string, boolean>>(checked);
  const [pending, start] = useTransition();

  const editable = rows.filter((r) => !r.locked);
  const dirty = editable.some((r) => checked[r.href] !== saved[r.href]);
  const customized = editable.filter((r) => checked[r.href] !== r.defaultAllowed).length;
  const sections = [...new Set(rows.map((r) => r.section))];

  const save = (values: Record<string, boolean>, message: string) =>
    start(async () => {
      const res = await saveScreenAccess(userId, Object.fromEntries(editable.map((r) => [r.href, values[r.href]])));
      if (!res.ok) return void toast.error(res.error);
      setChecked(values);
      setSaved(values);
      toast.success(message);
      router.refresh();
    });

  return (
    <section aria-label="Acesso às telas" className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Acesso às telas</h3>
        <p className="text-xs text-ink-2">
          O padrão de {name.split(' ')[0]} vem do perfil <b>{roleLabel}</b> e dos menus da empresa. Marque as telas que ela pode abrir; o que
          ficar diferente do padrão vale só para esta pessoa.
        </p>
      </div>

      {sections.map((section) => (
        <div key={section} className="rounded-xl border border-line">
          <p className="border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-2">{section}</p>
          <ul className="divide-y divide-line">
            {rows
              .filter((r) => r.section === section)
              .map((r) => {
                const diff = !r.locked && checked[r.href] !== r.defaultAllowed;
                return (
                  <li key={r.href}>
                    <label className={`flex items-start gap-3 px-3 py-2 ${r.locked ? 'opacity-70' : 'cursor-pointer hover:bg-surface-2'}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                        checked={checked[r.href] ?? false}
                        disabled={pending || Boolean(r.locked)}
                        onChange={(e) => setChecked((prev) => ({ ...prev, [r.href]: e.target.checked }))}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                          {r.label}
                          {r.locked && (
                            <Badge tone="neutral">
                              <Lock className="h-3 w-3" /> {LOCK_REASON[r.locked]}
                            </Badge>
                          )}
                          {diff && <Badge tone="info">Personalizado</Badge>}
                        </span>
                        <span className="block text-xs text-muted">{r.description}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={pending || !dirty} onClick={() => save(checked, 'Acesso às telas salvo')}>
          {pending ? 'Salvando…' : 'Salvar acesso às telas'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending || customized === 0}
          onClick={() => save({ ...checked, ...Object.fromEntries(editable.map((r) => [r.href, r.defaultAllowed])) }, 'Voltou ao padrão do perfil')}
        >
          <RotateCcw className="h-3.5 w-3.5" /> Voltar ao padrão do perfil
        </Button>
        {customized > 0 && <span className="text-xs text-muted">{customized} tela(s) diferente(s) do padrão</span>}
      </div>
    </section>
  );
}
