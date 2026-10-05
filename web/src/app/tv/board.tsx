'use client';

import { AlertOctagon, AlertTriangle, Bell, CheckCircle2, Maximize, Minimize, Smartphone, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { IndicatorView } from '@/components/indicators/views';
import { cn } from '@/lib/format';
import { formatValue, type IndicatorValue, type KpiData, type Tone } from '@/lib/indicators';
import { useRealtime } from '@/lib/use-realtime';

const REFRESH_MS = 60_000;

const TONE: Record<Exclude<Tone, null>, { bar: string; icon: typeof CheckCircle2; text: string; label: string }> = {
  good: { bar: 'bg-good', icon: CheckCircle2, text: 'text-good-ink', label: 'Dentro do esperado' },
  warning: { bar: 'bg-warning', icon: AlertTriangle, text: 'text-warning-ink', label: 'Atenção' },
  critical: { bar: 'bg-critical', icon: AlertOctagon, text: 'text-critical-ink', label: 'Crítico' },
};

/** Cartão de número na faixa do topo: nome, número grande, situação e uma linha de contexto. */
function KpiTile({ ind }: { ind: IndicatorValue }) {
  const d = ind.data as KpiData;
  const tone = d.tone ? TONE[d.tone] : null;
  const main = d.secondary?.[0];
  return (
    <div className="relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3">
      {tone && <span className={cn('absolute inset-y-0 left-0 w-1.5', tone.bar)} aria-hidden />}
      <div className="flex items-start justify-between gap-2">
        <p className="line-clamp-2 text-xs font-medium leading-snug text-ink-2">{ind.name}</p>
        {tone && <tone.icon className={cn('h-4 w-4 shrink-0', tone.text)} aria-label={tone.label} />}
      </div>
      <p className="mt-1 flex min-w-0 items-baseline gap-1.5">
        <span className="text-4xl font-semibold leading-none tracking-tight text-ink">{formatValue(d.value, d.format)}</span>
        {d.unit && <span className="truncate text-xs font-medium text-ink-2">{d.unit}</span>}
      </p>
      <p className="mt-1.5 truncate text-xs text-muted">
        {main ? `${main.label}: ${formatValue(main.value, main.format)}` : d.hint}
      </p>
    </div>
  );
}

/** Painel (gráfico, tabela ou cartão com lista): ocupa a célula toda e corta o que não couber. */
function Panel({ ind, timeZone }: { ind: IndicatorValue; timeZone: string }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 shrink-0 truncate text-sm font-semibold text-ink">{ind.name}</h2>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <IndicatorView data={ind.data} name={ind.name} timeZone={timeZone} expanded compact />
        {/* o que não couber some suavemente, sem barra de rolagem */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-surface to-transparent" />
      </div>
    </section>
  );
}

/** Peso do painel na grade: o horário de pico e tabelas largas ocupam duas colunas. */
const weightOf = (ind: IndicatorValue) => (ind.data.visual === 'heatmap' || ind.size >= 3 ? 2 : 1);

/**
 * Monta a grade dos painéis para encher a área inteira: escolhe linhas e colunas pela
 * quantidade de painéis e, quando uma linha não fecha, estica o maior painel dela.
 */
function packPanels(weights: number[]) {
  const total = weights.reduce((s, w) => s + w, 0);
  const rows = total <= 2 ? 1 : total <= 8 ? 2 : 3;
  const cols = Math.max(Math.max(1, ...weights), Math.ceil(total / rows));
  const spans = weights.map((w) => Math.min(w, cols));
  let row: number[] = [];
  let used = 0;
  let count = 0;
  const close = () => {
    if (!row.length) return;
    if (used < cols) {
      const grow = row.reduce((best, i) => (spans[i] >= spans[best] ? i : best), row[0]);
      spans[grow] += cols - used;
    }
    count += 1;
    row = [];
    used = 0;
  };
  spans.forEach((span, i) => {
    if (used + span > cols) close();
    row.push(i);
    used += span;
    if (used === cols) close();
  });
  close();
  return { cols, rows: count, spans };
}

/** Painéis por página na TV: até 4 "lugares" (2 × 2), para cada um ser lido de longe. */
const PAGE_CAPACITY = 4;

function paginate(panels: IndicatorValue[]) {
  const pages: IndicatorValue[][] = [];
  let page: IndicatorValue[] = [];
  let used = 0;
  for (const ind of panels) {
    const w = weightOf(ind);
    if (used + w > PAGE_CAPACITY && page.length) {
      pages.push(page);
      page = [];
      used = 0;
    }
    page.push(ind);
    used += w;
  }
  if (page.length) pages.push(page);
  // uma página só com um painel pequeno sobrando: junta à anterior (vira uma grade 3 × 2)
  if (pages.length > 1 && pages[pages.length - 1].reduce((s, i) => s + weightOf(i), 0) <= 1) {
    const last = pages.pop()!;
    pages[pages.length - 1].push(...last);
  }
  return pages;
}

function Clock({ timeZone }: { timeZone: string }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (!now) return <span className="text-2xl font-semibold tabular-nums">--:--</span>;
  return (
    <span className="text-right leading-tight">
      <span className="block text-2xl font-semibold tabular-nums text-ink">
        {new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(now)}
      </span>
      <span className="block text-xs capitalize text-muted">
        {new Intl.DateTimeFormat('pt-BR', { timeZone, weekday: 'long', day: '2-digit', month: 'short' }).format(now)}
      </span>
    </span>
  );
}

export function TvBoard({
  indicators,
  error,
  timeZone,
  scope,
  generatedAt,
  whatsapp,
  openAlerts,
  light,
  rotateSeconds,
}: {
  indicators: IndicatorValue[];
  error: string | null;
  timeZone: string;
  scope: string;
  generatedAt: string;
  whatsapp: { name: string; connected: boolean }[];
  openAlerts: number;
  light: boolean;
  /** segundos entre as páginas de painéis; 0 = tudo numa página só */
  rotateSeconds: number;
}) {
  const router = useRouter();
  const [fullscreen, setFullscreen] = useState(false);
  const [idle, setIdle] = useState(false);
  const [page, setPage] = useState(0);
  const pageCount = useRef(1);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // tela de parede: tema escuro (ou claro com ?tema=claro) e tudo em escala pelo tamanho da tela
  useEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.dataset.theme;
    const prevSize = root.style.fontSize;
    root.dataset.theme = light ? 'light' : 'dark';
    // 16px numa tela Full HD; cresce em 4K e diminui em telas menores
    root.style.fontSize = 'clamp(11px, 0.84vw, 30px)';
    return () => {
      if (prevTheme) root.dataset.theme = prevTheme;
      else delete root.dataset.theme;
      root.style.fontSize = prevSize;
    };
  }, [light]);

  // atualiza sozinho: a cada minuto e logo após mensagens, grupos ou alertas novos
  useEffect(() => {
    const id = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(id);
  }, [router]);
  const refreshSoon = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => router.refresh(), 4000);
  };
  useRealtime('tv-board', (channel) =>
    channel
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, refreshSoon)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'whatsapp_instances' }, refreshSoon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'demands' }, refreshSoon)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'indicators' }, refreshSoon),
  );

  // troca de página dos painéis
  useEffect(() => {
    if (rotateSeconds <= 0) return;
    const id = setInterval(() => setPage((p) => (p + 1) % Math.max(pageCount.current, 1)), rotateSeconds * 1000);
    return () => clearInterval(id);
  }, [rotateSeconds]);

  // esconde o cursor e o botão de tela cheia quando ninguém mexe no mouse
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      setIdle(false);
      clearTimeout(t);
      t = setTimeout(() => setIdle(true), 4000);
    };
    wake();
    window.addEventListener('mousemove', wake);
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      document.removeEventListener('fullscreenchange', onFs);
    };
  }, []);

  const valid = indicators.filter((i) => i.data.visual !== 'error');
  // número simples vai para a faixa do topo; gráfico, tabela e cartão com lista viram painel
  const kpis = valid.filter((i) => i.data.visual === 'kpi' && !(i.data as KpiData).list?.length);
  const panels = valid.filter((i) => !kpis.includes(i));
  // revezamento: páginas de até 4 painéis; sem revezamento, tudo numa página só
  const pages = rotateSeconds > 0 ? paginate(panels) : [panels];
  const current = Math.min(page, Math.max(pages.length - 1, 0));
  const shown = pages[current] ?? [];
  const grid = packPanels(shown.map(weightOf));
  useEffect(() => {
    pageCount.current = pages.length;
  });
  const allConnected = whatsapp.length > 0 && whatsapp.every((w) => w.connected);
  const updated = new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
    new Date(generatedAt),
  );

  return (
    <div className={cn('fixed inset-0 flex flex-col gap-3 overflow-hidden bg-bg p-3 text-ink', idle && 'cursor-none')}>
      {/* topo */}
      <header className="flex shrink-0 items-center justify-between gap-4 rounded-2xl border border-line bg-surface px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-4">
          <Logo />
          <div className="hidden min-w-0 border-l border-line pl-4 sm:block">
            <p className="truncate text-base font-semibold">Monitor de atendimento</p>
            <p className="truncate text-xs text-muted">{scope}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
              allConnected ? 'bg-good/12 text-good-ink' : 'bg-critical/12 text-critical-ink',
            )}
          >
            {allConnected ? <Smartphone className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {whatsapp.length === 0
              ? 'Nenhum WhatsApp conectado'
              : allConnected
                ? 'WhatsApp conectado'
                : `${whatsapp.filter((w) => !w.connected).length} WhatsApp desconectado(s)`}
          </span>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
              openAlerts > 0 ? 'bg-critical/12 text-critical-ink' : 'bg-surface-2 text-ink-2',
            )}
          >
            <Bell className="h-4 w-4" />
            {openAlerts > 0 ? `${openAlerts} alerta(s) aberto(s)` : 'Sem alertas abertos'}
          </span>
          {pages.length > 1 && (
            <span className="flex items-center gap-1.5" aria-label={`Página ${current + 1} de ${pages.length}`}>
              {pages.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setPage(i)}
                  className={cn('h-2 rounded-full transition-all', i === current ? 'w-6 bg-brand' : 'w-2 bg-ink-2/40')}
                  aria-label={`Ir para a página ${i + 1}`}
                />
              ))}
            </span>
          )}
          <span className="hidden text-xs text-muted lg:inline" suppressHydrationWarning>
            atualizado às {updated}
          </span>
          <Clock timeZone={timeZone} />
          <button
            type="button"
            onClick={() =>
              document.fullscreenElement ? void document.exitFullscreen() : void document.documentElement.requestFullscreen()
            }
            className={cn(
              'rounded-xl p-2 text-ink-2 transition hover:bg-surface-2 hover:text-ink',
              idle && 'pointer-events-none opacity-0',
            )}
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
          </button>
        </div>
      </header>

      {error ? (
        <div className="flex flex-1 items-center justify-center text-critical-ink">
          Não foi possível carregar os indicadores: {error}
        </div>
      ) : valid.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-ink-2">
          Nenhum indicador ativo. Ative-os em Configurações › Indicadores.
        </div>
      ) : (
        <>
          {/* faixa de números */}
          {kpis.length > 0 && (
            <div className="grid shrink-0 gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(11.5rem, 1fr))' }}>
              {kpis.map((ind) => (
                <KpiTile key={ind.key} ind={ind} />
              ))}
            </div>
          )}

          {/* painéis enchendo o resto da tela */}
          {shown.length > 0 && (
            <div
              key={current}
              className="grid min-h-0 flex-1 gap-3 animate-[tvfade_.6s_ease]"
              style={{
                gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))`,
              }}
            >
              {shown.map((ind, i) => (
                <div key={ind.key} className="flex min-h-0 min-w-0" style={{ gridColumn: `span ${grid.spans[i]}` }}>
                  <Panel ind={ind} timeZone={timeZone} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
