import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { QueueDepth, TrafficPoint, WaitTimeBucket, WarmupOverviewItem } from '../lib/api';
import { useCurrentUser } from '../lib/useCurrentUser';
import {
  ChartTooltip,
  PERIOD_PRESETS,
  bucketTraffic,
  formatCompact,
  pctDelta,
  splitHalves,
  statusPillTextColor,
  usePalette,
} from '../lib/chartTheme';
import { HistoryIcon, LayersIcon, PercentIcon, TrendUpIcon } from '../components/icons';

const WARMUP_LABEL: Record<WarmupOverviewItem['warmupLevel'], string> = { cold: 'Frio', warm: 'Morno', hot: 'Quente' };

const QUEUE_LABEL: Record<keyof QueueDepth, string> = {
  waiting: 'Aguardando',
  active: 'Ativas',
  delayed: 'Adiadas (rate limit)',
  completed: 'Concluídas',
  failed: 'Falhou',
  paused: 'Pausadas',
  prioritized: 'Priorizadas',
  'waiting-children': 'Aguard. filhos',
};

function Card({ title, icon, children }: { title: string; icon?: ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
        {icon}
        {title}
      </h2>
      {children}
    </div>
  );
}

// direction: true = subir e bom (ex: volume, taxa de entrega). Cor vem dos
// tokens de status/delta da paleta validada, nunca escolhida a olho.
function DeltaBadge({ deltaPct, goodColor, badColor }: { deltaPct: number | null; goodColor: string; badColor: string }) {
  if (deltaPct === null) return null;
  const isUp = deltaPct >= 0;
  const color = isUp ? goodColor : badColor;
  return (
    <span className="ml-1.5 inline-flex items-center gap-0.5 text-xs font-medium" style={{ color }}>
      {isUp ? '▲' : '▼'} {Math.abs(deltaPct).toFixed(1)}%
    </span>
  );
}

// good/warning só passam contraste de texto (4.5:1) com tinta escura por
// cima; critical só passa com branco - ver statusPillTextColor. O valor
// grande NUNCA leva a cor de status diretamente (warning em texto grande
// sobre fundo claro cai pra 1.83:1, ilegível) - status vira um pill pequeno
// à parte, com o par de cor certo pra cada fundo.
function StatusPill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      className="mt-1.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: bg, color: fg }}
    >
      {label}
    </span>
  );
}

function StatCard({
  icon,
  accentBg,
  accentFg,
  label,
  value,
  sublabel,
  statusPill,
  deltaPct,
  deltaGoodColor,
  deltaBadColor,
}: {
  icon: ReactNode;
  accentBg: string;
  accentFg: string;
  label: string;
  value: string;
  sublabel?: string;
  statusPill?: { label: string; bg: string; fg: string };
  deltaPct?: number | null;
  deltaGoodColor?: string;
  deltaBadColor?: string;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
          <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {value}
            {deltaPct !== undefined && (
              <DeltaBadge deltaPct={deltaPct} goodColor={deltaGoodColor ?? '#0ca30c'} badColor={deltaBadColor ?? '#d03b3b'} />
            )}
          </p>
          {sublabel && <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{sublabel}</p>}
          {statusPill && <StatusPill {...statusPill} />}
        </div>
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accentBg, color: accentFg }}
        >
          {icon}
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: me } = useCurrentUser();
  const palette = usePalette();
  const [periodHours, setPeriodHours] = useState(48);

  const { data: traffic, isLoading: loadingTraffic } = useQuery({
    queryKey: ['analytics', 'traffic', periodHours],
    queryFn: async () => (await api.get<TrafficPoint[]>('/analytics/traffic', { params: { hours: periodHours } })).data,
    refetchInterval: 15000,
    placeholderData: (prev) => prev,
  });

  const { data: queueDepth } = useQuery({
    queryKey: ['analytics', 'queue-depth'],
    queryFn: async () => (await api.get<QueueDepth>('/analytics/queue-depth')).data,
    refetchInterval: 5000,
  });

  const { data: waitTime } = useQuery({
    queryKey: ['analytics', 'wait-time', periodHours],
    queryFn: async () => (await api.get<WaitTimeBucket[]>('/analytics/wait-time', { params: { hours: periodHours } })).data,
    refetchInterval: 15000,
    placeholderData: (prev) => prev,
  });

  const { data: warmupOverview } = useQuery({
    queryKey: ['analytics', 'warmup-overview'],
    queryFn: async () => (await api.get<WarmupOverviewItem[]>('/analytics/warmup-overview')).data,
    refetchInterval: 10000,
  });

  const rawTraffic = traffic ?? [];
  const trafficData = bucketTraffic(rawTraffic, periodHours);

  const queueData = queueDepth
    ? (Object.keys(QUEUE_LABEL) as (keyof QueueDepth)[]).map((key) => ({
        name: QUEUE_LABEL[key],
        value: queueDepth[key],
        // Emphasis: só o que precisa de atenção operacional (falhas) leva cor
        // de status; o resto fica neutro - evita "arco-iris" de 8 hues numa
        // unica serie (ver references/anti-patterns.md da skill de dataviz).
        color: key === 'failed' ? palette.critical : palette.mutedInk,
      }))
    : [];

  // Totais do periodo selecionado - usados nos cards e no delta (2a metade
  // do periodo buscado vs a 1a, sem chamada extra ao backend).
  const totalSent = rawTraffic.reduce((sum, p) => sum + p.sent, 0);
  const totalFailed = rawTraffic.reduce((sum, p) => sum + p.failed, 0);
  const totalAttempted = totalSent + totalFailed;
  const deliveryRate = totalAttempted > 0 ? (totalSent / totalAttempted) * 100 : null;

  const { previous: prevHalf, current: curHalf } = splitHalves(rawTraffic);
  const sentDeltaPct = pctDelta(
    prevHalf.reduce((s, p) => s + p.sent, 0),
    curHalf.reduce((s, p) => s + p.sent, 0),
  );
  const prevAttempted = prevHalf.reduce((s, p) => s + p.sent + p.failed, 0);
  const curAttempted = curHalf.reduce((s, p) => s + p.sent + p.failed, 0);
  const prevRate = prevAttempted > 0 ? (prevHalf.reduce((s, p) => s + p.sent, 0) / prevAttempted) * 100 : null;
  const curRate = curAttempted > 0 ? (curHalf.reduce((s, p) => s + p.sent, 0) / curAttempted) * 100 : null;
  const rateDeltaPct = prevRate !== null && curRate !== null ? curRate - prevRate : null;

  const connectedInstances = warmupOverview?.filter((i) => i.status === 'connected').length ?? 0;
  const totalInstances = warmupOverview?.length ?? 0;
  const instancesStatus =
    totalInstances === 0
      ? null
      : connectedInstances === totalInstances
        ? ({ label: 'Todas conectadas', color: palette.good } as const)
        : connectedInstances === 0
          ? ({ label: 'Nenhuma conectada', color: palette.critical } as const)
          : ({ label: 'Parcialmente conectado', color: palette.warning } as const);

  const rateStatus =
    deliveryRate === null
      ? null
      : deliveryRate >= 95
        ? ({ label: 'Saudável', color: palette.good } as const)
        : deliveryRate >= 80
          ? ({ label: 'Atenção', color: palette.warning } as const)
          : ({ label: 'Crítico', color: palette.critical } as const);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {me ? `Bem-vindo de volta, ${me.name.split(' ')[0]}!` : 'Visão geral dos seus disparos.'}
          </p>
        </div>

        {/* Filtro de periodo - uma unica linha, acima de tudo que ele escopa
            (traffic + wait-time; fila e aquecimento sao snapshot ao vivo) */}
        <div className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">
          {PERIOD_PRESETS.map((preset) => (
            <button
              key={preset.hours}
              onClick={() => setPeriodHours(preset.hours)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                periodHours === preset.hours
                  ? 'bg-emerald-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          icon={<TrendUpIcon className="h-5 w-5" />}
          accentBg="rgba(42,120,214,0.12)"
          accentFg={palette.categorical1}
          label="Mensagens enviadas"
          value={formatCompact(totalSent)}
          deltaPct={sentDeltaPct}
          deltaGoodColor={palette.deltaGood}
          deltaBadColor={palette.critical}
        />
        <StatCard
          icon={<PercentIcon className="h-5 w-5" />}
          accentBg={rateStatus ? rateStatus.color : `${palette.mutedInk}1f`}
          accentFg={rateStatus ? statusPillTextColor(rateStatus.color, palette) : palette.mutedInk}
          label="Taxa de entrega"
          value={deliveryRate !== null ? `${deliveryRate.toFixed(1)}%` : '—'}
          sublabel={totalAttempted > 0 ? `${totalSent} de ${totalAttempted} tentativas` : 'Sem envios no período'}
          statusPill={
            rateStatus
              ? { label: rateStatus.label, bg: rateStatus.color, fg: statusPillTextColor(rateStatus.color, palette) }
              : undefined
          }
          deltaPct={rateDeltaPct}
          deltaGoodColor={palette.deltaGood}
          deltaBadColor={palette.critical}
        />
        <StatCard
          icon={<LayersIcon className="h-5 w-5" />}
          accentBg={instancesStatus ? instancesStatus.color : `${palette.mutedInk}1f`}
          accentFg={instancesStatus ? statusPillTextColor(instancesStatus.color, palette) : palette.mutedInk}
          label="Instâncias conectadas"
          value={`${connectedInstances}/${totalInstances}`}
          statusPill={
            instancesStatus
              ? {
                  label: instancesStatus.label,
                  bg: instancesStatus.color,
                  fg: statusPillTextColor(instancesStatus.color, palette),
                }
              : undefined
          }
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Tráfego (${PERIOD_PRESETS.find((p) => p.hours === periodHours)?.label})`} icon={<TrendUpIcon className="h-4 w-4 text-gray-400" />}>
          {loadingTraffic && !trafficData.length && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}
          {!loadingTraffic && trafficData.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Sem envios no período.</p>
          )}
          {trafficData.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trafficData}>
                <CartesianGrid strokeDasharray="none" stroke={palette.gridline} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: palette.secondaryInk }} stroke={palette.baseline} />
                <YAxis
                  tick={{ fontSize: 11, fill: palette.secondaryInk }}
                  stroke={palette.baseline}
                  allowDecimals={false}
                  tickFormatter={(v) => v.toLocaleString('pt-BR')}
                />
                <Tooltip content={<ChartTooltip palette={palette} />} />
                <Legend
                  wrapperStyle={{ fontSize: 12, color: palette.secondaryInk }}
                  iconType="plainline"
                  iconSize={12}
                />
                <Area
                  type="monotone"
                  dataKey="sent"
                  name="Enviadas"
                  stackId="1"
                  fill={palette.good}
                  fillOpacity={0.12}
                  stroke={palette.good}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  name="Falharam"
                  stackId="1"
                  fill={palette.critical}
                  fillOpacity={0.12}
                  stroke={palette.critical}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="pending"
                  name="Pendentes"
                  stackId="1"
                  fill={palette.warning}
                  fillOpacity={0.12}
                  stroke={palette.warning}
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Profundidade da fila (agora)" icon={<LayersIcon className="h-4 w-4 text-gray-400" />}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={queueData} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="none" stroke={palette.gridline} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11, fill: palette.secondaryInk }} stroke={palette.baseline} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: palette.secondaryInk }} stroke={palette.baseline} width={110} />
              <Tooltip content={<ChartTooltip palette={palette} />} cursor={{ fill: palette.gridline, opacity: 0.4 }} />
              <Bar dataKey="value" name="Jobs" radius={[0, 4, 4, 0]} maxBarSize={20}>
                {queueData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card
          title={`Tempo de espera até o envio (${PERIOD_PRESETS.find((p) => p.hours === periodHours)?.label})`}
          icon={<HistoryIcon className="h-4 w-4 text-gray-400" />}
        >
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={waitTime ?? []}>
              <CartesianGrid strokeDasharray="none" stroke={palette.gridline} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: palette.secondaryInk }} stroke={palette.baseline} />
              <YAxis tick={{ fontSize: 11, fill: palette.secondaryInk }} stroke={palette.baseline} allowDecimals={false} />
              <Tooltip content={<ChartTooltip palette={palette} />} cursor={{ fill: palette.gridline, opacity: 0.4 }} />
              <Bar dataKey="count" name="Mensagens" radius={[4, 4, 0, 0]} maxBarSize={40}>
                {(waitTime ?? []).map((_, i) => (
                  <Cell key={i} fill={palette.ordinalBlue[Math.min(i, palette.ordinalBlue.length - 1)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Aquecimento por instância" icon={<PercentIcon className="h-4 w-4 text-gray-400" />}>
          <div className="space-y-3">
            {warmupOverview?.map((item) => {
              // "hot"/"warm" usam os tokens de status (good/warning) validados
              // pra texto solido; "cold" nao e bem um status (so informa que
              // e nova), fica com a classe azul neutra ja usada no resto do
              // app - o par blue+tinta escura fica abaixo de 4.5:1 pra texto
              // pequeno (checado com validate_palette.js/contrast()), diferente
              // dos tres tokens de status que ja vem com o par certo.
              const statusColor = item.warmupLevel === 'hot' ? palette.good : item.warmupLevel === 'warm' ? palette.warning : null;
              return (
                <div key={item.instanceId} className="rounded-md border border-gray-100 p-3 dark:border-gray-800">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{item.instanceId}</span>
                    {statusColor ? (
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-medium"
                        style={{ background: statusColor, color: statusPillTextColor(statusColor, palette) }}
                      >
                        {WARMUP_LABEL[item.warmupLevel]}
                      </span>
                    ) : (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                        {WARMUP_LABEL[item.warmupLevel]}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <div>
                      <div>Minuto</div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {item.used.minute}/{item.limits.perMinute}
                      </div>
                    </div>
                    <div>
                      <div>Hora</div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {item.used.hour}/{item.limits.perHour}
                      </div>
                    </div>
                    <div>
                      <div>Dia</div>
                      <div className="font-medium text-gray-900 dark:text-gray-100">
                        {item.used.day}/{item.limits.perDay}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {warmupOverview?.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma instância pareada ainda.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
