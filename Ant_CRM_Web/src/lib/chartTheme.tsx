import { useEffect, useState } from 'react';
import type { TrafficPoint } from './api';

// Paleta validada (skill de dataviz) - hues fixos, checados contra CVD/contraste.
// Status nunca muda por tema (mesmo hex claro/escuro); o resto troca por modo.
export interface ChartPalette {
  surface: string;
  // fundo dos cards (bg-white / dark:bg-gray-900) - é a cor do "vão" de 2px
  // entre segmentos empilhados, que precisa sumir no fundo do card
  card: string;
  primaryInk: string;
  secondaryInk: string;
  mutedInk: string;
  gridline: string;
  baseline: string;
  good: string;
  warning: string;
  critical: string;
  deltaGood: string;
  categorical1: string;
  // rampa ordinal (1 hue, mais escuro = mais longe/pior) - usada nos buckets
  // de tempo de espera, que tem ordem real (<5s ... 5min+)
  ordinalBlue: string[];
}

const STATUS = { good: '#0ca30c', warning: '#fab219', critical: '#d03b3b' };

// Rampa ordinal (1 hue azul, magnitude crescente) validada com
// scripts/validate_palette.js --ordinal pra cada modo separadamente - a
// ancoragem inverte no escuro (perto-de-zero fica no passo mais escuro em
// AMBOS os modos, mas o passo mais claro que sobra pra "maior magnitude"
// muda de lado porque o piso de contraste 2:1 é contra superficies opostas).
// 5 tons pros 6 buckets de espera - o ultimo (">5min") reaproveita o tom mais
// escuro do quinto, ok pois o rotulo no eixo ja diferencia os dois.
const ORDINAL_BLUE_LIGHT = ['#86b6ef', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const ORDINAL_BLUE_DARK = ['#184f95', '#256abf', '#3987e5', '#86b6ef', '#cde2fb'];

const LIGHT: ChartPalette = {
  surface: '#fcfcfb',
  card: '#ffffff',
  primaryInk: '#0b0b0b',
  secondaryInk: '#52514e',
  mutedInk: '#898781',
  gridline: '#e1e0d9',
  baseline: '#c3c2b7',
  ...STATUS,
  deltaGood: '#006300',
  categorical1: '#2a78d6',
  ordinalBlue: ORDINAL_BLUE_LIGHT,
};

const DARK: ChartPalette = {
  surface: '#1a1a19',
  card: '#111827',
  primaryInk: '#ffffff',
  secondaryInk: '#c3c2b7',
  mutedInk: '#898781',
  gridline: '#2c2c2a',
  baseline: '#383835',
  ...STATUS,
  deltaGood: '#0ca30c',
  categorical1: '#3987e5',
  ordinalBlue: ORDINAL_BLUE_DARK,
};

// Acompanha a classe "dark" no <html> (alternada por src/lib/theme.ts) via
// MutationObserver - os graficos usam hex literal (nao CSS var()) pra evitar
// qualquer inconsistencia de suporte a var() em atributos SVG entre navegadores.
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains('dark'));

  useEffect(() => {
    const target = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(target.classList.contains('dark')));
    observer.observe(target, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

export function usePalette(): ChartPalette {
  return useIsDark() ? DARK : LIGHT;
}

// Texto sobre pill de status: good/warning só passam 4.5:1 com tinta escura
// (good vs branco = 3.35, warning vs branco = 1.83); critical só passa com
// branco (vs tinta escura = 4.10, abaixo do minimo). Checado com
// scripts/validate_palette.js (contrast()), não no olho.
export function statusPillTextColor(statusHex: string, palette: ChartPalette): string {
  return statusHex === palette.critical ? '#ffffff' : '#0b0b0b';
}

export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('pt-BR');
}

export type PeriodId = 'today' | '24h' | '48h' | '7d' | '30d';

export interface PeriodPreset {
  id: PeriodId;
  label: string;
  // como o período aparece numa frase ("Enviadas hoje", "Enviadas nos últimos 7 dias")
  phrase: string;
  // null = desde a meia-noite de hoje (no fuso de quem está olhando)
  hours: number | null;
}

export const PERIOD_PRESETS: PeriodPreset[] = [
  { id: 'today', label: 'Hoje', phrase: 'hoje', hours: null },
  { id: '24h', label: '24h', phrase: 'nas últimas 24h', hours: 24 },
  { id: '48h', label: '48h', phrase: 'nas últimas 48h', hours: 48 },
  { id: '7d', label: '7 dias', phrase: 'nos últimos 7 dias', hours: 24 * 7 },
  { id: '30d', label: '30 dias', phrase: 'nos últimos 30 dias', hours: 24 * 30 },
];

const HOUR_MS = 3_600_000;

// Início do período, calculado no navegador de propósito: "hoje" é a
// meia-noite do fuso do usuário, que o servidor não conhece.
export function periodStart(preset: PeriodPreset, now = new Date()): Date {
  if (preset.hours === null) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  return new Date(now.getTime() - preset.hours * HOUR_MS);
}

export interface TrafficBucket {
  // início do intervalo (ms) - chave estável pra tabela/eixo
  start: number;
  label: string;
  sent: number;
  failed: number;
  pending: number;
}

// Monta a série do gráfico de tráfego com TODOS os intervalos do período,
// inclusive os sem envio (zerados). O backend só devolve as horas que
// tiveram mensagem; sem preencher os buracos, duas horas distantes ficavam
// lado a lado no eixo e o gráfico escondia justamente os períodos parados.
//
// Até 48h cada barra é uma hora; acima disso, um dia (no fuso do usuário -
// agrupar pela data UTC jogava os envios da noite no dia seguinte).
export function bucketTraffic(points: TrafficPoint[], since: Date, until = new Date()): TrafficBucket[] {
  const byDay = until.getTime() - since.getTime() > 48 * HOUR_MS;

  const startOf = (date: Date): Date =>
    byDay
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate())
      : new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
  const next = (date: Date): Date => {
    const copy = new Date(date);
    if (byDay) copy.setDate(copy.getDate() + 1);
    else copy.setHours(copy.getHours() + 1);
    return copy;
  };
  const sameDayRange = startOf(since).toDateString() === until.toDateString();
  const labelOf = (date: Date): string => {
    const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    if (byDay) return day;
    const hour = `${String(date.getHours()).padStart(2, '0')}h`;
    return sameDayRange ? hour : `${day} ${hour}`;
  };

  const buckets = new Map<number, TrafficBucket>();
  for (let cursor = startOf(since); cursor <= until; cursor = next(cursor)) {
    buckets.set(cursor.getTime(), { start: cursor.getTime(), label: labelOf(cursor), sent: 0, failed: 0, pending: 0 });
  }

  for (const point of points) {
    const bucket = buckets.get(startOf(new Date(point.hour)).getTime());
    if (!bucket) continue;
    bucket.sent += point.sent;
    bucket.failed += point.failed;
    bucket.pending += point.pending;
  }

  return Array.from(buckets.values());
}

// Variação percentual contra o período anterior. Sem base (anterior = 0) não
// existe percentual honesto - devolve null e a tela diz "sem base anterior"
// em vez de inventar um "+100%".
export function pctDelta(previous: number, current: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

// Tooltip compartilhado pros graficos do dashboard - valor em destaque
// (primaryInk, negrito), label secundario, swatch de cor em vez de caixa
// cheia (ver references/interaction.md da skill de dataviz).
export function ChartTooltip({
  active,
  payload,
  label,
  palette,
  valueFormatter,
}: {
  active?: boolean;
  payload?: { dataKey?: string; name?: string; value?: number; color?: string }[];
  label?: string;
  palette: ChartPalette;
  valueFormatter?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;

  return (
    <div
      style={{
        background: palette.surface,
        border: `1px solid ${palette.gridline}`,
        borderRadius: 8,
        padding: '8px 10px',
        fontSize: 12,
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        minWidth: 140,
      }}
    >
      {label && <div style={{ color: palette.secondaryInk, marginBottom: 4, fontSize: 11 }}>{label}</div>}
      {payload.map((entry, i) => (
        <div key={entry.dataKey ?? i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: i ? 3 : 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: entry.color, flexShrink: 0 }} />
          <span style={{ color: palette.secondaryInk, flex: 1 }}>{entry.name}</span>
          <span style={{ color: palette.primaryInk, fontWeight: 600 }}>
            {valueFormatter && entry.value !== undefined ? valueFormatter(entry.value) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}
