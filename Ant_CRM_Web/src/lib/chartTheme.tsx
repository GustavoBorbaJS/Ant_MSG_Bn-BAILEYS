import { useEffect, useState } from 'react';
import type { TrafficPoint } from './api';

// Paleta validada (skill de dataviz) - hues fixos, checados contra CVD/contraste.
// Status nunca muda por tema (mesmo hex claro/escuro); o resto troca por modo.
export interface ChartPalette {
  surface: string;
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

export const PERIOD_PRESETS: { label: string; hours: number }[] = [
  { label: '24h', hours: 24 },
  { label: '48h', hours: 48 },
  { label: '7 dias', hours: 24 * 7 },
  { label: '30 dias', hours: 24 * 30 },
];

// Acima de 48h, agrupar por hora vira ruido ilegivel (ate 720 pontos) - reagrupa
// por dia no cliente em vez de mudar o endpoint (que continua servindo por hora).
export function bucketTraffic(points: TrafficPoint[], hours: number): Array<TrafficPoint & { label: string }> {
  if (hours <= 48) {
    return points.map((p) => ({
      ...p,
      label: new Date(p.hour).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit' }),
    }));
  }

  const byDay = new Map<string, TrafficPoint>();
  for (const p of points) {
    const dateKey = p.hour.slice(0, 10);
    const bucket = byDay.get(dateKey) ?? { hour: dateKey, sent: 0, failed: 0, pending: 0 };
    bucket.sent += p.sent;
    bucket.failed += p.failed;
    bucket.pending += p.pending;
    byDay.set(dateKey, bucket);
  }

  return Array.from(byDay.values())
    .sort((a, b) => a.hour.localeCompare(b.hour))
    .map((b) => ({ ...b, label: new Date(b.hour).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) }));
}

// Compara a 2a metade do periodo buscado com a 1a - sem chamada extra ao
// backend. Metrica generica: soma de "sent" (volume) ou taxa de entrega.
export function splitHalves<T>(points: T[]): { previous: T[]; current: T[] } {
  const mid = Math.floor(points.length / 2);
  return { previous: points.slice(0, mid), current: points.slice(mid) };
}

export function pctDelta(previous: number, current: number): number | null {
  if (previous > 0) return ((current - previous) / previous) * 100;
  if (current > 0) return 100;
  return null;
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
