import { useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import type { QueueDepth, TrafficPoint, WaitTimeBucket, WarmupOverviewItem } from '../lib/api';

const WARMUP_LABEL: Record<WarmupOverviewItem['warmupLevel'], string> = { cold: 'Frio', warm: 'Morno', hot: 'Quente' };
const WARMUP_COLOR: Record<WarmupOverviewItem['warmupLevel'], string> = {
  cold: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  warm: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  hot: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

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

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
      <h2 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">{title}</h2>
      {children}
    </div>
  );
}

export function DashboardPage() {
  const { data: traffic, isLoading: loadingTraffic } = useQuery({
    queryKey: ['analytics', 'traffic'],
    queryFn: async () => (await api.get<TrafficPoint[]>('/analytics/traffic', { params: { hours: 48 } })).data,
    refetchInterval: 15000,
  });

  const { data: queueDepth } = useQuery({
    queryKey: ['analytics', 'queue-depth'],
    queryFn: async () => (await api.get<QueueDepth>('/analytics/queue-depth')).data,
    refetchInterval: 5000,
  });

  const { data: waitTime } = useQuery({
    queryKey: ['analytics', 'wait-time'],
    queryFn: async () => (await api.get<WaitTimeBucket[]>('/analytics/wait-time', { params: { hours: 48 } })).data,
    refetchInterval: 15000,
  });

  const { data: warmupOverview } = useQuery({
    queryKey: ['analytics', 'warmup-overview'],
    queryFn: async () => (await api.get<WarmupOverviewItem[]>('/analytics/warmup-overview')).data,
    refetchInterval: 10000,
  });

  const trafficData = (traffic ?? []).map((point) => ({
    ...point,
    label: new Date(point.hour).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit' }),
  }));

  const queueData = queueDepth
    ? (Object.keys(QUEUE_LABEL) as (keyof QueueDepth)[]).map((key) => ({
        name: QUEUE_LABEL[key],
        value: queueDepth[key],
      }))
    : [];

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Dashboard</h1>

      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Tráfego (últimas 48h)">
          {loadingTraffic && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}
          {!loadingTraffic && trafficData.length === 0 && (
            <p className="text-sm text-gray-400 dark:text-gray-500">Sem envios no período.</p>
          )}
          {trafficData.length > 0 && (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trafficData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-800" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="sent" name="Enviadas" stackId="1" fill="#22c55e" stroke="#16a34a" />
                <Area type="monotone" dataKey="failed" name="Falharam" stackId="1" fill="#ef4444" stroke="#dc2626" />
                <Area type="monotone" dataKey="pending" name="Pendentes" stackId="1" fill="#eab308" stroke="#ca8a04" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Profundidade da fila (agora)">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={queueData} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-800" />
              <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
              <Tooltip />
              <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Tempo de espera até o envio (últimas 48h)">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={waitTime ?? []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-800" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="count" name="Mensagens" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Aquecimento por instância">
          <div className="space-y-3">
            {warmupOverview?.map((item) => (
              <div key={item.instanceId} className="rounded-md border border-gray-100 p-3 dark:border-gray-800">
                <div className="mb-2 flex items-center justify-between">
                  <span className="font-mono text-sm text-gray-900 dark:text-gray-100">{item.instanceId}</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${WARMUP_COLOR[item.warmupLevel]}`}>
                    {WARMUP_LABEL[item.warmupLevel]}
                  </span>
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
            ))}
            {warmupOverview?.length === 0 && (
              <p className="text-sm text-gray-400 dark:text-gray-500">Nenhuma instância pareada ainda.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
