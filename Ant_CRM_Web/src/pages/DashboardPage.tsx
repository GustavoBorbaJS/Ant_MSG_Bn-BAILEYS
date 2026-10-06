import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../lib/api';
import type {
  AnalyticsSummary,
  InstanceStatus,
  QueueDepth,
  TrafficPoint,
  WaitTimeBucket,
  WarmupOverviewItem,
} from '../lib/api';
import { useCurrentUser } from '../lib/useCurrentUser';
import {
  ChartTooltip,
  PERIOD_PRESETS,
  bucketTraffic,
  formatCompact,
  pctDelta,
  periodStart,
  statusPillTextColor,
  usePalette,
} from '../lib/chartTheme';
import type { ChartPalette, PeriodId } from '../lib/chartTheme';
import { HistoryIcon, LayersIcon, PercentIcon, SendIcon, TrendUpIcon } from '../components/icons';

const WARMUP_LABEL: Record<WarmupOverviewItem['warmupLevel'], string> = { cold: 'Frio', warm: 'Morno', hot: 'Quente' };

const INSTANCE_STATUS_LABEL: Record<InstanceStatus, string> = {
  connected: 'Conectada',
  connecting: 'Conectando',
  qr_code: 'Aguardando QR',
  pairing_code: 'Aguardando código',
  disconnected: 'Desconectada',
};

// buckets de espera abaixo de 1 minuto (ver WAIT_BUCKETS em
// Ant_CRM_Bn/src/analytics/analytics.service.ts) - usados no resumo do card
const UNDER_ONE_MINUTE = new Set(['<5s', '5-15s', '15-30s', '30-60s']);

const REFRESH_MS = 15_000;

function formatNumber(n: number): string {
  return n.toLocaleString('pt-BR');
}

function Card({
  title,
  subtitle,
  icon,
  aside,
  className = '',
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${className}`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-800 dark:text-gray-200">
            {icon}
            {title}
          </h2>
          {subtitle && <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{subtitle}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-400 dark:border-gray-800 dark:text-gray-500">
      {children}
    </div>
  );
}

// Variação contra o período anterior de mesma duração. A cor diz se a
// mudança é boa ou ruim (subir falha é ruim), a seta diz a direção - nunca
// só a cor. Sem base anterior, diz isso em vez de mostrar um percentual.
function Delta({
  value,
  unit,
  upIsGood,
  palette,
}: {
  value: number | null;
  unit: '%' | 'p.p.';
  upIsGood: boolean;
  palette: ChartPalette;
}) {
  if (value === null) {
    return <span className="text-xs text-gray-400 dark:text-gray-500">sem base anterior</span>;
  }
  if (Math.abs(value) < 0.05) {
    return <span className="text-xs text-gray-500 dark:text-gray-400">= igual ao período anterior</span>;
  }

  const isUp = value > 0;
  const color = isUp === upIsGood ? palette.deltaGood : palette.critical;
  return (
    <span className="text-xs text-gray-500 dark:text-gray-400">
      <span className="font-semibold" style={{ color }}>
        {isUp ? '▲' : '▼'} {Math.abs(value).toFixed(1).replace('.', ',')}
        {unit === '%' ? '%' : ' p.p.'}
      </span>{' '}
      vs. período anterior
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  detail,
  pill,
  children,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  detail?: string;
  pill?: { label: string; bg: string; fg: string };
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
        <span className="text-gray-400 dark:text-gray-500">{icon}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <p className="text-3xl font-bold leading-none text-gray-900 dark:text-gray-100">{value}</p>
        {pill && (
          <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: pill.bg, color: pill.fg }}>
            {pill.label}
          </span>
        )}
      </div>
      {detail && <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">{detail}</p>}
      {children && <div className="mt-1.5">{children}</div>}
    </div>
  );
}

// Barra de proporção: o preenchimento carrega a gravidade e o trilho é a
// mesma cor bem clara, pra o estado ler na barra inteira.
function Meter({ used, limit, palette }: { used: number; limit: number; palette: ChartPalette }) {
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  const color = share >= 1 ? palette.critical : share >= 0.9 ? palette.warning : palette.categorical1;
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full"
      style={{ background: `${color}2e` }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={limit}
      aria-valuenow={used}
    >
      <div className="h-full rounded-full" style={{ width: `${share * 100}%`, background: color }} />
    </div>
  );
}

export function DashboardPage() {
  const { data: me } = useCurrentUser();
  const palette = usePalette();
  const [periodId, setPeriodId] = useState<PeriodId>('today');
  const period = PERIOD_PRESETS.find((preset) => preset.id === periodId)!;

  // "since" é calculado na hora de cada busca (não no render): o período
  // "últimas 24h" anda junto com o relógio a cada atualização automática.
  const sinceParam = () => ({ since: periodStart(period).toISOString() });

  const {
    data: summary,
    dataUpdatedAt,
    isPlaceholderData,
  } = useQuery({
    queryKey: ['analytics', 'summary', periodId],
    queryFn: async () => (await api.get<AnalyticsSummary>('/analytics/summary', { params: sinceParam() })).data,
    refetchInterval: REFRESH_MS,
    placeholderData: (prev) => prev,
  });

  const { data: traffic } = useQuery({
    queryKey: ['analytics', 'traffic', periodId],
    queryFn: async () => (await api.get<TrafficPoint[]>('/analytics/traffic', { params: sinceParam() })).data,
    refetchInterval: REFRESH_MS,
    placeholderData: (prev) => prev,
  });

  const { data: waitTime } = useQuery({
    queryKey: ['analytics', 'wait-time', periodId],
    queryFn: async () => (await api.get<WaitTimeBucket[]>('/analytics/wait-time', { params: sinceParam() })).data,
    refetchInterval: REFRESH_MS,
    placeholderData: (prev) => prev,
  });

  const { data: queueDepth } = useQuery({
    queryKey: ['analytics', 'queue-depth'],
    queryFn: async () => (await api.get<QueueDepth>('/analytics/queue-depth')).data,
    refetchInterval: 5000,
  });

  const { data: warmupOverview } = useQuery({
    queryKey: ['analytics', 'warmup-overview'],
    queryFn: async () => (await api.get<WarmupOverviewItem[]>('/analytics/warmup-overview')).data,
    refetchInterval: 10000,
  });

  // Ao trocar de período, os números do anterior ficam na tela esmaecidos até
  // os novos chegarem, em vez de piscar "carregando" e fazer o layout pular.
  const stale = isPlaceholderData;
  // mesma regra do bucketTraffic: até 48h uma barra por hora, acima disso por dia
  const trafficUnit = (period.hours ?? 24) > 48 ? 'dia' : 'hora';

  const current = summary?.current ?? { sent: 0, failed: 0, pending: 0 };
  const previous = summary?.previous ?? { sent: 0, failed: 0, pending: 0 };

  const finished = current.sent + current.failed;
  const previousFinished = previous.sent + previous.failed;
  const deliveryRate = finished > 0 ? (current.sent / finished) * 100 : null;
  const previousRate = previousFinished > 0 ? (previous.sent / previousFinished) * 100 : null;
  const rateDelta = deliveryRate !== null && previousRate !== null ? deliveryRate - previousRate : null;
  const total = finished + current.pending;

  const rateStatus =
    deliveryRate === null
      ? null
      : deliveryRate >= 95
        ? { label: 'Saudável', color: palette.good }
        : deliveryRate >= 80
          ? { label: 'Atenção', color: palette.warning }
          : { label: 'Crítico', color: palette.critical };

  const trafficData = bucketTraffic(traffic ?? [], summary ? new Date(summary.since) : periodStart(period));
  const hasTraffic = trafficData.some((bucket) => bucket.sent + bucket.failed + bucket.pending > 0);

  // ordem fixa enviadas -> pendentes -> falharam, no gráfico e na barra de
  // situação: o cinza neutro no meio separa o verde do vermelho, que são os
  // dois que mais se confundem pra quem tem daltonismo
  const statusSeries = [
    { key: 'sent' as const, label: 'Enviadas', color: palette.good },
    { key: 'pending' as const, label: 'Na fila', color: palette.mutedInk },
    { key: 'failed' as const, label: 'Falharam', color: palette.critical },
  ];

  const waitTotal = (waitTime ?? []).reduce((sum, bucket) => sum + bucket.count, 0);
  const waitUnderMinute = (waitTime ?? []).filter((b) => UNDER_ONE_MINUTE.has(b.label)).reduce((sum, b) => sum + b.count, 0);

  const connectedInstances = warmupOverview?.filter((item) => item.status === 'connected').length ?? 0;
  const totalInstances = warmupOverview?.length ?? 0;

  const axisTick = { fontSize: 11, fill: palette.secondaryInk };

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {me ? `Bem-vindo de volta, ${me.name.split(' ')[0]}!` : 'Visão geral dos seus disparos.'}
          </p>
        </div>

        {/* Um único filtro de período, acima de tudo que ele recorta: os
            cartões do topo, o tráfego, a situação das mensagens e o tempo de
            espera. Só "agora no sistema" e o aquecimento são retratos ao vivo. */}
        <div className="flex flex-col items-start gap-1 sm:items-end">
          <div
            role="group"
            aria-label="Período"
            className="flex gap-1 rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900"
          >
            {PERIOD_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setPeriodId(preset.id)}
                aria-pressed={periodId === preset.id}
                className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                  periodId === preset.id
                    ? 'bg-emerald-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            {dataUpdatedAt
              ? `Atualizado às ${new Date(dataUpdatedAt).toLocaleTimeString('pt-BR')} · atualiza sozinho a cada ${REFRESH_MS / 1000}s`
              : 'Carregando...'}
          </p>
        </div>
      </div>

      <div className={`transition-opacity ${stale ? 'opacity-50' : ''}`}>
        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<SendIcon className="h-4 w-4" />}
            label={`Enviadas ${period.phrase}`}
            value={formatCompact(current.sent)}
            detail={`${formatNumber(total)} mensagens disparadas no período`}
          >
            <Delta value={pctDelta(previous.sent, current.sent)} unit="%" upIsGood palette={palette} />
          </StatCard>

          <StatCard
            icon={<PercentIcon className="h-4 w-4" />}
            label="Taxa de entrega"
            value={deliveryRate !== null ? `${deliveryRate.toFixed(1).replace('.', ',')}%` : '—'}
            detail={
              finished > 0
                ? `${formatNumber(current.sent)} de ${formatNumber(finished)} concluídas`
                : 'Nenhum envio concluído no período'
            }
            pill={
              rateStatus
                ? { label: rateStatus.label, bg: rateStatus.color, fg: statusPillTextColor(rateStatus.color, palette) }
                : undefined
            }
          >
            {deliveryRate !== null && <Delta value={rateDelta} unit="p.p." upIsGood palette={palette} />}
          </StatCard>

          <StatCard
            icon={<TrendUpIcon className="h-4 w-4" />}
            label={`Falharam ${period.phrase}`}
            value={formatCompact(current.failed)}
            detail="Número inválido, instância fora do ar ou recusa do WhatsApp"
          >
            <Delta value={pctDelta(previous.failed, current.failed)} unit="%" upIsGood={false} palette={palette} />
          </StatCard>

          <StatCard
            icon={<LayersIcon className="h-4 w-4" />}
            label="Na fila"
            value={formatCompact(current.pending)}
            detail={`Disparadas ${period.phrase} e ainda aguardando a vez de envio`}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card
            className="lg:col-span-2"
            title={`Tráfego ${period.phrase}`}
            subtitle={`Mensagens por ${trafficUnit} em que foram disparadas, pela situação atual de cada uma`}
            icon={<TrendUpIcon className="h-4 w-4 text-gray-400" />}
          >
            {!hasTraffic && <EmptyState>Nenhuma mensagem disparada {period.phrase}.</EmptyState>}
            {hasTraffic && (
              <>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={trafficData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                    <CartesianGrid stroke={palette.gridline} vertical={false} />
                    <XAxis dataKey="label" tick={axisTick} stroke={palette.baseline} tickLine={false} minTickGap={24} />
                    <YAxis
                      tick={axisTick}
                      stroke={palette.baseline}
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      tickFormatter={formatNumber}
                    />
                    <Tooltip
                      content={<ChartTooltip palette={palette} valueFormatter={formatNumber} />}
                      cursor={{ fill: palette.gridline, opacity: 0.5 }}
                    />
                    {statusSeries.map((series, index) => (
                      <Bar
                        key={series.key}
                        dataKey={series.key}
                        name={series.label}
                        stackId="status"
                        fill={series.color}
                        stroke={palette.card}
                        strokeWidth={1}
                        maxBarSize={24}
                        radius={index === statusSeries.length - 1 ? [3, 3, 0, 0] : 0}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>

                {/* legenda própria (não a do Recharts): mantém a ordem do
                    empilhamento e o texto em cor de texto - a identidade vem
                    do quadradinho ao lado, não de colorir a palavra */}
                <ul className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
                  {statusSeries.map((series) => (
                    <li key={series.key} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: series.color }} />
                      {series.label}
                    </li>
                  ))}
                </ul>

                <details className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  <summary className="cursor-pointer select-none hover:text-gray-900 dark:hover:text-gray-100">
                    Ver os números em tabela
                  </summary>
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-gray-100 dark:border-gray-800">
                    <table className="w-full text-left tabular-nums">
                      <thead className="sticky top-0 bg-gray-50 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Intervalo</th>
                          {statusSeries.map((series) => (
                            <th key={series.key} className="px-3 py-1.5 text-right font-medium">
                              {series.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trafficData.map((bucket) => (
                          <tr key={bucket.start} className="border-t border-gray-100 dark:border-gray-800">
                            <td className="px-3 py-1">{bucket.label}</td>
                            {statusSeries.map((series) => (
                              <td key={series.key} className="px-3 py-1 text-right text-gray-900 dark:text-gray-100">
                                {formatNumber(bucket[series.key])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </Card>

          <Card
            title={`Situação das mensagens ${period.phrase}`}
            subtitle="Onde está cada mensagem disparada no período"
            icon={<LayersIcon className="h-4 w-4 text-gray-400" />}
          >
            {total === 0 ? (
              <EmptyState>Nenhuma mensagem no período.</EmptyState>
            ) : (
              <>
                <div className="mb-3 flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
                  {statusSeries
                    .filter((series) => current[series.key] > 0)
                    .map((series) => (
                      <div
                        key={series.key}
                        style={{ width: `${(current[series.key] / total) * 100}%`, background: series.color }}
                        title={`${series.label}: ${formatNumber(current[series.key])}`}
                      />
                    ))}
                </div>
                <dl className="space-y-1.5 text-sm">
                  {statusSeries.map((series) => (
                    <div key={series.key} className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: series.color }} />
                      <dt className="flex-1 text-gray-600 dark:text-gray-400">{series.label}</dt>
                      <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                        {formatNumber(current[series.key])}
                      </dd>
                      <dd className="w-12 text-right text-xs tabular-nums text-gray-400 dark:text-gray-500">
                        {((current[series.key] / total) * 100).toFixed(0)}%
                      </dd>
                    </div>
                  ))}
                  <div className="flex items-center gap-2 border-t border-gray-100 pt-1.5 dark:border-gray-800">
                    <span className="h-2.5 w-2.5 shrink-0" />
                    <dt className="flex-1 text-gray-600 dark:text-gray-400">Total</dt>
                    <dd className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">{formatNumber(total)}</dd>
                    <dd className="w-12" />
                  </div>
                </dl>
              </>
            )}

            <div className="mt-4 border-t border-gray-100 pt-3 dark:border-gray-800">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Agora no sistema
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { label: 'Aguardando', value: queueDepth?.waiting },
                  { label: 'Enviando', value: queueDepth?.active },
                  { label: 'Adiadas', value: queueDepth?.delayed },
                ].map((item) => (
                  <div key={item.label} className="rounded-lg bg-gray-50 px-2 py-2 dark:bg-gray-800/60">
                    <div className="text-lg font-bold leading-none text-gray-900 dark:text-gray-100">
                      {item.value === undefined ? '—' : formatNumber(item.value)}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.label}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
                Fila de envio neste instante, somando todos os usuários. Adiadas = esperando a vez pelo espaçamento
                do anti-ban, ou agendadas para depois.
              </p>
            </div>
          </Card>

          <Card
            className="lg:col-span-2"
            title={`Tempo até o envio ${period.phrase}`}
            subtitle={
              waitTotal > 0
                ? `${formatNumber(waitTotal)} mensagens enviadas · ${((waitUnderMinute / waitTotal) * 100).toFixed(0)}% saíram em menos de 1 minuto`
                : 'Quanto tempo cada mensagem ficou na fila antes de sair'
            }
            icon={<HistoryIcon className="h-4 w-4 text-gray-400" />}
          >
            {waitTotal === 0 ? (
              <EmptyState>Nenhuma mensagem enviada {period.phrase}.</EmptyState>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={waitTime ?? []} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
                  <CartesianGrid stroke={palette.gridline} vertical={false} />
                  <XAxis dataKey="label" tick={axisTick} stroke={palette.baseline} tickLine={false} />
                  <YAxis
                    tick={axisTick}
                    stroke={palette.baseline}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                    tickFormatter={formatNumber}
                  />
                  <Tooltip
                    content={<ChartTooltip palette={palette} valueFormatter={formatNumber} />}
                    cursor={{ fill: palette.gridline, opacity: 0.5 }}
                  />
                  <Bar dataKey="count" name="Mensagens" radius={[4, 4, 0, 0]} maxBarSize={24}>
                    {(waitTime ?? []).map((bucket, index) => (
                      <Cell key={bucket.label} fill={palette.ordinalBlue[Math.min(index, palette.ordinalBlue.length - 1)]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>

          <Card
            title="Instâncias e aquecimento"
            subtitle="Uso do limite de hoje, ao vivo"
            icon={<PercentIcon className="h-4 w-4 text-gray-400" />}
            aside={
              totalInstances > 0 ? (
                <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
                  {connectedInstances} de {totalInstances} conectadas
                </span>
              ) : undefined
            }
          >
            <div className="space-y-3">
              {warmupOverview?.map((item) => {
                const connected = item.status === 'connected';
                return (
                  <div key={item.instanceId} className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-sm text-gray-900 dark:text-gray-100">{item.instanceId}</span>
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                        {WARMUP_LABEL[item.warmupLevel]}
                      </span>
                    </div>
                    <Meter used={item.used.day} limit={item.limits.perDay} palette={palette} />
                    <div className="mt-1.5 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: connected ? palette.good : palette.mutedInk }}
                        />
                        {INSTANCE_STATUS_LABEL[item.status as InstanceStatus] ?? item.status}
                      </span>
                      <span className="tabular-nums">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {formatNumber(item.used.day)}/{formatNumber(item.limits.perDay)}
                        </span>{' '}
                        hoje · {item.used.hour}/{item.limits.perHour} na hora
                      </span>
                    </div>
                  </div>
                );
              })}
              {warmupOverview?.length === 0 && <EmptyState>Nenhuma instância pareada ainda.</EmptyState>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
