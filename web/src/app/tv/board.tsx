'use client';

import { AlertOctagon, AlertTriangle, Bell, CheckCircle2, Maximize, Minimize, Smartphone, WifiOff } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
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
    <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface px-4 py-3">
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
/**
 * Rolagem automática para a TV (ninguém usa o mouse): desce devagar quando o conteúdo não
 * cabe, espera no fim e volta ao topo. Para enquanto o mouse está em cima e respeita
 * "reduzir movimento" do sistema.
 */
function useAutoScroll(ref: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let hover = false;
    let wait = 60; // ~3s parado no topo antes de começar
    let pos = 0;
    const enter = () => (hover = true);
    const leave = () => (hover = false);
    el.addEventListener('mouseenter', enter);
    el.addEventListener('mouseleave', leave);
    const id = setInterval(() => {
      if (hover || el.scrollHeight - el.clientHeight < 4) return;
      if (wait > 0) {
        wait -= 1;
        return;
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        wait = 60;
        pos = 0;
        el.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      pos = Math.max(pos, el.scrollTop) + 0.6;
      el.scrollTop = pos;
    }, 50);
    return () => {
      clearInterval(id);
      el.removeEventListener('mouseenter', enter);
      el.removeEventListener('mouseleave', leave);
    };
  }, [ref]);
}

/**
 * Painel (gráfico, tabela ou cartão com lista). Com capRows, mostra só essa quantidade de linhas
 * de dados e o resto fica na rolagem; sem capRows, ocupa a altura disponível e rola se precisar.
 */
function Panel({ ind, timeZone, capRows }: { ind: IndicatorValue; timeZone: string; capRows?: number }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  useAutoScroll(scroller);

  // altura exata de N linhas de dados (tabela ou lista), medida depois de desenhar
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || !capRows) return;
    const measure = () => {
      const rows = el.querySelectorAll<HTMLElement>('tbody tr, ul > li');
      if (rows.length <= capRows) return setMaxHeight(undefined);
      const top = el.getBoundingClientRect().top - el.scrollTop;
      setMaxHeight(Math.ceil(rows[capRows].getBoundingClientRect().top - top));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [capRows, ind.data]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface p-4">
      <h2 className="mb-2 shrink-0 truncate text-sm font-semibold text-ink">{ind.name}</h2>
      <div
        ref={scroller}
        className={cn('tv-scroll min-h-0 overflow-y-auto overscroll-contain', !capRows && 'flex-1')}
        style={capRows ? { maxHeight } : undefined}
      >
        <IndicatorView data={ind.data} name={ind.name} timeZone={timeZone} expanded compact />
      </div>
    </section>
  );
}

/** Peso do painel na grade: o horário de pico e tabelas largas ocupam duas colunas. */
const weightOf = (ind: IndicatorValue) => (ind.data.visual === 'heatmap' || ind.size >= 3 ? 2 : 1);

/**
 * Divide os itens em linhas equilibradas, mantendo a ordem: cada linha recebe um peso
 * parecido e, dentro dela, a largura é repartida entre todos os itens (proporcional ao peso).
 * Assim nenhum item sozinho (ex.: o último da linha) fica esticado para tapar a sobra.
 */
function balancedRows<T>(items: T[], weight: (item: T) => number, rowCount: number): T[][] {
  const rows: T[][] = [];
  let rest = items.reduce((s, i) => s + weight(i), 0);
  let i = 0;
  for (let r = rowCount; r > 0 && i < items.length; r--) {
    const target = rest / r;
    const row: T[] = [];
    let sum = 0;
    // deixa pelo menos um item para cada linha que ainda falta
    while (i < items.length && items.length - i > r - 1) {
      const w = weight(items[i]);
      if (row.length && Math.abs(sum + w - target) > Math.abs(sum - target)) break;
      row.push(items[i]);
      sum += w;
      i += 1;
      if (sum >= target) break;
    }
    rows.push(row);
    rest -= sum;
  }
  if (i < items.length) rows[rows.length - 1].push(...items.slice(i));
  return rows.filter((r) => r.length);
}

/** Quantas linhas de painéis: 1 até 3 "lugares", 2 até 8, depois 3. */
const panelRowCount = (total: number) => (total <= 3 ? 1 : total <= 8 ? 2 : 3);

/** Linhas de dados visíveis nos painéis da primeira linha (o resto fica na rolagem). */
const FIRST_ROW_LINES = 5;

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
  const panelRows = balancedRows(
    shown,
    weightOf,
    Math.min(shown.length, panelRowCount(shown.reduce((sum, i) => sum + weightOf(i), 0))),
  );
  // números: uma linha só até 10; acima disso, duas linhas com a mesma quantidade (±1)
  const kpiRows = balancedRows(kpis, () => 1, kpis.length > 10 ? 2 : 1);
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
            <div className="flex shrink-0 flex-col gap-3">
              {kpiRows.map((row, r) => (
                <div key={r} className="flex gap-3">
                  {row.map((ind) => (
                    <div key={ind.key} className="flex min-w-0 flex-1 basis-0">
                      <KpiTile ind={ind} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* painéis enchendo o resto da tela */}
          {shown.length > 0 && (
            <div key={current} className="flex min-h-0 flex-1 flex-col gap-3 animate-[tvfade_.6s_ease]">
              {panelRows.map((row, r) => {
                // primeira linha compacta (5 linhas de dados, o resto rola); as demais dividem o restante
                const compactRow = r === 0 && panelRows.length > 1;
                return (
                  <div key={r} className={cn('flex min-h-0 gap-3', compactRow ? 'shrink-0' : 'flex-1 basis-0')}>
                    {row.map((ind) => (
                      <div key={ind.key} className="flex min-h-0 min-w-0 basis-0" style={{ flexGrow: weightOf(ind) }}>
                        <Panel ind={ind} timeZone={timeZone} capRows={compactRow ? FIRST_ROW_LINES : undefined} />
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
