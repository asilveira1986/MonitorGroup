'use client';

import { BellRing, PlayCircle, Save, Timer, Volume2 } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TEST_EVENT } from '@/components/message-notifier';
import { Button, Card, CardHeader, Select } from '@/components/ui';
import type { AppSettings } from '@/lib/types';
import { saveMessageAlertSettings } from './actions';
import { Row } from './demand-settings';

const AUTO_CLOSE_OPTIONS = [5, 10, 15, 30, 60, 120, 300];
const label = (s: number) => (s < 60 ? `${s} segundos` : s === 60 ? '1 minuto' : `${s / 60} minutos`);

/** Alerta de nova mensagem: ligar, tempo na tela (até fechar ou fecha sozinho) e som. */
export function MessageAlertSettings({ settings, disabled }: { settings: AppSettings; disabled: boolean }) {
  const [enabled, setEnabled] = useState(settings.msg_alert_enabled ?? true);
  const [autoClose, setAutoClose] = useState(settings.msg_alert_auto_close ?? 0);
  const [sound, setSound] = useState(settings.msg_alert_sound ?? true);
  const [pending, start] = useTransition();
  const mode = autoClose > 0 ? 'auto' : 'stay';

  return (
    <Card>
      <CardHeader
        title="Alerta de nova mensagem"
        description="Aviso no centro da tela, com o grupo e a mensagem, sempre que um cliente escreve. Vale para todos os usuários; cada um ainda pode silenciar no próprio navegador pelo sino do topo."
      />
      <div className="divide-y divide-line px-4 pb-4 sm:px-5">
        <Row
          icon={BellRing}
          title="Mostrar o alerta de nova mensagem"
          text="Abre o aviso no centro da tela com o nome do grupo, quem enviou e a mensagem."
          checked={enabled}
          onChange={setEnabled}
          disabled={disabled || pending}
        />
        {enabled && (
          <>
            <div className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex gap-3">
                <Timer className="mt-0.5 h-5 w-5 shrink-0 text-muted" />
                <div>
                  <p className="text-sm font-medium">Tempo na tela</p>
                  <p className="mt-0.5 text-xs text-ink-2">
                    Deixar o alerta na tela até alguém fechar, ou fechar sozinho depois de um tempo (a contagem pausa com o
                    mouse sobre o alerta).
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:w-64">
                <Select
                  value={mode}
                  onChange={(e) => setAutoClose(e.target.value === 'auto' ? autoClose || 15 : 0)}
                  disabled={disabled || pending}
                  aria-label="Tempo na tela"
                >
                  <option value="stay">Deixar na tela até fechar</option>
                  <option value="auto">Fechar sozinho</option>
                </Select>
                {mode === 'auto' && (
                  <Select
                    value={autoClose}
                    onChange={(e) => setAutoClose(Number(e.target.value))}
                    disabled={disabled || pending}
                    aria-label="Fechar depois de"
                  >
                    {AUTO_CLOSE_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        Fechar depois de {label(s)}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            </div>
            <Row
              icon={Volume2}
              title="Tocar som"
              text="Um bipe curto junto com o alerta. O navegador só libera o som depois do primeiro clique na página."
              checked={sound}
              onChange={setSound}
              disabled={disabled || pending}
            />
          </>
        )}
        <div className="flex flex-wrap gap-2 pt-4">
          {!disabled && (
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await saveMessageAlertSettings({ enabled, autoClose, sound });
                  if (res.ok) toast.success('Configuração do alerta salva');
                  else toast.error(res.error);
                })
              }
            >
              <Save className="h-3.5 w-3.5" /> Salvar
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            onClick={() => window.dispatchEvent(new Event(TEST_EVENT))}
            title="Mostra um alerta de exemplo com a configuração salva"
          >
            <PlayCircle className="h-3.5 w-3.5" /> Testar alerta
          </Button>
        </div>
      </div>
    </Card>
  );
}
