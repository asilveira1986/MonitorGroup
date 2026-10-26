'use client';

import { BellOff, BellRing, Loader2, Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button, Toggle } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';

type Kind = 'alert' | 'demand' | 'agenda' | 'private';
const KINDS: { kind: Kind; label: string }[] = [
  { kind: 'alert', label: 'Alertas dos grupos (cliente sem resposta, palavras críticas...)' },
  { kind: 'demand', label: 'Demandas: atribuídas a mim, vencendo e atrasadas' },
  { kind: 'agenda', label: 'Agenda: 15 min antes e quando me incluírem' },
  { kind: 'private', label: 'Mensagens novas nas conversas privadas' },
];

type State = 'loading' | 'unsupported' | 'ios-install' | 'denied' | 'off' | 'on';

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}
/** chave pública (base64url) no formato que o navegador pede */
function keyBytes(base64url: string) {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

/**
 * Notificações push neste aparelho (0098): ativa/desativa, manda um teste e escolhe os avisos.
 * No iPhone só funciona com o sistema adicionado à Tela de Início (iOS 16.4+).
 */
export function PushSettings({ userId, agendaOnly }: { userId: string; agendaOnly?: boolean }) {
  const [state, setState] = useState<State>('loading');
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState<Partial<Record<Kind, boolean>>>({});
  const [canPrivate, setCanPrivate] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = createClient();
      const [{ data: profile }, { data: allowed }] = await Promise.all([
        supabase.from('profiles').select('push_prefs').eq('id', userId).maybeSingle(),
        supabase.rpc('can_use_private_chats'),
      ]);
      if (!alive) return;
      setPrefs((profile?.push_prefs as Partial<Record<Kind, boolean>> | null) ?? {});
      setCanPrivate(Boolean(allowed));

      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        setState(isIos() && !isStandalone() ? 'ios-install' : 'unsupported');
        return;
      }
      if (isIos() && !isStandalone()) return setState('ios-install');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (alive) setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const enable = async () => {
    setBusy(true);
    try {
      // a permissão precisa ser pedida logo no toque (exigência do iPhone)
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        if (permission !== 'denied') toast.error('Permita as notificações quando o aparelho perguntar.');
        return;
      }
      const supabase = createClient();
      const { data: publicKey } = await supabase.rpc('push_public_key');
      if (!publicKey) {
        toast.error('As notificações ainda não estão prontas', {
          description: 'O worker precisa estar atualizado e no ar (ele gera as chaves de envio).',
        });
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey as string) });
      const json = sub.toJSON();
      const { error } = await supabase.rpc('save_push_subscription', {
        p_endpoint: json.endpoint,
        p_p256dh: json.keys?.p256dh,
        p_auth: json.keys?.auth,
        p_user_agent: navigator.userAgent,
      });
      if (error) {
        toast.error('Não foi possível ativar', { description: error.message });
        return;
      }
      setState('on');
      await supabase.rpc('push_test');
      toast.success('Notificações ativadas neste aparelho', { description: 'Enviamos uma notificação de teste.' });
    } catch (err) {
      toast.error('Não foi possível ativar as notificações', { description: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await createClient().rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setState('off');
      toast.success('Notificações desativadas neste aparelho');
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    const { error } = await createClient().rpc('push_test');
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success('Teste enviado', { description: 'Chega em alguns segundos.' });
  };

  const setPref = async (kind: Kind, on: boolean) => {
    const next = { ...prefs, [kind]: on };
    setPrefs(next);
    const { error } = await createClient().rpc('set_push_prefs', { p_prefs: next });
    if (error) toast.error('Não foi possível salvar', { description: error.message });
  };

  const kinds = KINDS.filter((k) => (k.kind === 'private' ? canPrivate : !agendaOnly || k.kind === 'agenda'));

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Notificações neste aparelho</p>
          <p className="text-xs text-ink-2">
            {state === 'on'
              ? 'Ativadas: os avisos chegam mesmo com o sistema fechado.'
              : 'Receba os avisos no celular ou no computador, mesmo com o sistema fechado.'}
          </p>
        </div>
        {state === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-muted" />}
        {state === 'off' && (
          <Button type="button" size="sm" onClick={enable} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Ativar
          </Button>
        )}
        {state === 'on' && (
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="secondary" onClick={test} disabled={busy}>
              Testar
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={disable} disabled={busy} title="Desativar neste aparelho">
              <BellOff className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
      {state === 'ios-install' && (
        <p className="rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
          No iPhone, abra o sistema pelo Safari, toque em <Share className="inline h-3.5 w-3.5 align-text-bottom" /> <b>Compartilhar</b> ›{' '}
          <b>Adicionar à Tela de Início</b> e entre pelo ícone criado. Depois volte aqui e toque em Ativar (precisa do iOS 16.4 ou mais novo).
        </p>
      )}
      {state === 'denied' && (
        <p className="rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
          As notificações foram bloqueadas para este site. Libere nos ajustes do navegador (ou, no iPhone, em Ajustes › Notificações › Monitor
          Group) e abra esta janela de novo.
        </p>
      )}
      {state === 'unsupported' && <p className="text-xs text-muted">Este navegador não recebe notificações push.</p>}
      {state === 'on' && (
        <div className="space-y-2">
          {kinds.map((k) => (
            <Toggle key={k.kind} checked={prefs[k.kind] !== false} onChange={(on) => void setPref(k.kind, on)} label={<span className="text-xs">{k.label}</span>} />
          ))}
        </div>
      )}
    </div>
  );
}
