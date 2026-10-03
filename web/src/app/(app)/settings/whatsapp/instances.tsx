'use client';

import { CheckCircle2, Loader2, LogOut, Plus, QrCode, RefreshCw, Smartphone, Trash2, WifiOff } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge, Button, Card, EmptyState, Input } from '@/components/ui';
import { formatPhone, timeAgo } from '@/lib/format';
import { createClient } from '@/lib/supabase/client';
import type { Instance } from '@/lib/types';
import { useRealtime } from '@/lib/use-realtime';
import { createInstance, deleteInstance, requestInstanceAction } from '../actions';
import { WorkerStatus } from './worker-status';

const STATUS = {
  connected: { label: 'Conectado', tone: 'good' as const, icon: CheckCircle2 },
  qr: { label: 'Aguardando leitura do QR code', tone: 'warning' as const, icon: QrCode },
  connecting: { label: 'Conectando…', tone: 'info' as const, icon: Loader2 },
  disconnected: { label: 'Desconectado', tone: 'critical' as const, icon: WifiOff },
};

export function InstancesPanel({ initial, isAdmin }: { initial: Instance[]; isAdmin: boolean }) {
  const [instances, setInstances] = useState(initial);
  const [pending, start] = useTransition();
  const [name, setName] = useState('');
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const onWorkerChange = useCallback((online: boolean | null) => setWorkerOnline(online), []);
  const waiting = instances.some((i) => i.status === 'connecting' || i.status === 'qr' || i.requested_action);

  // Reserva caso o tempo real não esteja disponível: consulta enquanto aguarda o QR code
  useEffect(() => {
    if (!waiting) return;
    const supabase = createClient();
    const id = setInterval(async () => {
      const { data } = await supabase.from('whatsapp_instances').select('*').order('created_at');
      if (data) setInstances(data as Instance[]);
    }, 3_000);
    return () => clearInterval(id);
  }, [waiting]);

  // Atualiza status e QR code em tempo real
  useRealtime('instances', (channel) =>
    channel.on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_instances' }, (payload) => {
      setInstances((list) => {
        if (payload.eventType === 'DELETE') return list.filter((i) => i.id !== (payload.old as Instance).id);
        const row = payload.new as Instance;
        const exists = list.some((i) => i.id === row.id);
        return exists ? list.map((i) => (i.id === row.id ? row : i)) : [...list, row];
      });
    }),
  );

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error);
      else if (ok) toast.success(ok);
    });

  return (
    <div className="space-y-4">
      <WorkerStatus onChange={onWorkerChange} />
      {isAdmin && (
        <Card className="p-5">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => createInstance(name || 'WhatsApp principal'), 'Gerando QR code…');
              setName('');
            }}
          >
            <div className="flex-1">
              <p className="text-sm font-semibold">Conectar um número de WhatsApp</p>
              <p className="text-xs text-muted">
                Use o número que participa dos grupos de clientes. Ele continuará funcionando normalmente no celular.
              </p>
            </div>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome (ex.: Suporte)"
              className="sm:w-56"
            />
            <Button disabled={pending}>
              <Plus className="h-4 w-4" /> Nova conexão
            </Button>
          </form>
        </Card>
      )}

      {instances.length === 0 && (
        <Card>
          <EmptyState
            icon={<Smartphone />}
            title="Nenhum WhatsApp conectado"
            description="Crie uma conexão e leia o QR code com o celular para começar a monitorar os grupos."
          />
        </Card>
      )}

      {instances.map((inst) => {
        const status = STATUS[inst.status];
        const Icon = status.icon;
        return (
          <Card key={inst.id} className="p-5">
            <div className="flex flex-col gap-5 md:flex-row">
              <div className="flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <h3 className="text-lg font-semibold">{inst.name}</h3>
                  <Badge tone={status.tone}>
                    <Icon className={`h-3.5 w-3.5 ${inst.status === 'connecting' ? 'animate-spin' : ''}`} />
                    {status.label}
                  </Badge>
                </div>
                {inst.phone && (
                  <p className="text-sm text-ink-2">
                    <Smartphone className="mr-1 inline h-4 w-4" />
                    {formatPhone(inst.phone)} {inst.push_name && `· ${inst.push_name}`}
                  </p>
                )}
                {inst.status === 'connected' && (
                  <p className="text-xs text-muted">
                    Conectado {timeAgo(inst.connected_at)} · último sinal {timeAgo(inst.last_seen_at)}
                  </p>
                )}
                {inst.status === 'connecting' && workerOnline === false && (
                  <p className="rounded-lg bg-critical/10 px-3 py-2 text-xs text-critical-ink">
                    O QR code não vai aparecer enquanto o worker estiver fora do ar (veja o aviso acima).
                  </p>
                )}
                {inst.last_error && inst.status !== 'connected' && (
                  <p className="rounded-lg bg-critical/10 px-3 py-2 text-xs text-critical-ink">{inst.last_error}</p>
                )}
                {inst.status === 'qr' && (
                  <ol className="list-inside list-decimal space-y-1 text-sm text-ink-2">
                    <li>Abra o WhatsApp no celular</li>
                    <li>
                      Toque em <strong>Mais opções ⋮</strong> ou <strong>Configurações</strong> e depois em{' '}
                      <strong>Aparelhos conectados</strong>
                    </li>
                    <li>
                      Toque em <strong>Conectar um aparelho</strong> e aponte a câmera para o QR code
                    </li>
                  </ol>
                )}
                {isAdmin && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {inst.status !== 'connected' && (
                      <Button
                        size="sm"
                        disabled={pending}
                        onClick={() => run(() => requestInstanceAction(inst.id, 'connect'))}
                      >
                        <RefreshCw className="h-3.5 w-3.5" />{' '}
                        {inst.status === 'qr'
                          ? 'Gerar novo QR code'
                          : inst.status === 'connecting'
                            ? 'Tentar novamente'
                            : 'Conectar'}
                      </Button>
                    )}
                    {inst.status === 'connected' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pending}
                        onClick={() => {
                          if (confirm('Desconectar este WhatsApp? O monitoramento será interrompido.'))
                            run(() => requestInstanceAction(inst.id, 'logout'), 'Desconectando…');
                        }}
                      >
                        <LogOut className="h-3.5 w-3.5" /> Desconectar
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() => {
                        if (confirm('Excluir esta conexão e TODOS os grupos e mensagens dela?'))
                          run(() => deleteInstance(inst.id), 'Conexão excluída');
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Excluir
                    </Button>
                  </div>
                )}
              </div>

              {(inst.status === 'qr' || inst.status === 'connecting') && (
                <div className="flex h-[264px] w-[264px] shrink-0 items-center justify-center self-center rounded-2xl border border-line bg-white p-3">
                  {inst.status === 'qr' && inst.qr_code ? (
                    <QRCodeSVG value={inst.qr_code} size={236} level="L" />
                  ) : (
                    <div className="flex flex-col items-center gap-2 text-xs text-neutral-500">
                      <Loader2 className="h-6 w-6 animate-spin" /> Gerando QR code…
                      <span className="px-4 text-center text-[11px]">
                        Se demorar mais de 1 minuto, verifique se o worker está no ar.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
