import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { HealthCheckStatus, HealthVerdict, InstanceHealth } from '../lib/api';

const VERDICT_LABEL: Record<HealthVerdict, string> = {
  healthy: 'Saudável',
  attention: 'Atenção',
  critical: 'Crítico',
};

const VERDICT_COLOR: Record<HealthVerdict, string> = {
  healthy: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  attention: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const CHECK_DOT: Record<HealthCheckStatus, string> = {
  ok: 'bg-green-500',
  warn: 'bg-amber-500',
  fail: 'bg-red-500',
};

// Checagem sob demanda (GET /instances/:id/health). Sem refetch automático de
// propósito: cada checagem consulta o provedor de verdade e, com a IA ligada,
// faz uma chamada paga - só roda ao abrir e no botão "Verificar de novo".
export function InstanceHealthPanel({ instanceId }: { instanceId: string }) {
  const {
    data: health,
    isFetching,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['instance-health', instanceId],
    queryFn: async () => (await api.get<InstanceHealth>(`/instances/${instanceId}/health`)).data,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });

  if (!health) {
    return (
      <p className="py-6 text-center text-sm text-gray-400 dark:text-gray-500">
        {isError ? 'Não foi possível verificar a saúde dessa instância.' : 'Verificando a saúde da instância...'}
      </p>
    );
  }

  return (
    <div className="text-left">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VERDICT_COLOR[health.verdict]}`}>
          {VERDICT_LABEL[health.verdict]} · {health.score}/100
        </span>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-xs text-gray-500 hover:text-gray-900 disabled:opacity-40 dark:text-gray-400 dark:hover:text-gray-100"
        >
          {isFetching ? 'Verificando...' : 'Verificar de novo'}
        </button>
      </div>

      {(health.phoneNumber || health.displayName) && (
        <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
          {[health.displayName, health.phoneNumber].filter(Boolean).join(' · ')}
        </p>
      )}

      <ul className="mb-3 space-y-2">
        {health.checks.map((check) => (
          <li key={check.id} className="flex gap-2 text-sm">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${CHECK_DOT[check.status]}`} />
            <span>
              <span className="font-medium text-gray-900 dark:text-gray-100">{check.label}</span>
              <span className="block text-xs text-gray-500 dark:text-gray-400">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>

      {health.ai && (
        <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm dark:border-gray-700 dark:bg-gray-800">
          <p className="mb-1 text-xs font-medium uppercase text-gray-500 dark:text-gray-400">Diagnóstico da IA</p>
          <p className="text-gray-700 dark:text-gray-300">{health.ai.summary}</p>
          <AiList title="Riscos" items={health.ai.risks} />
          <AiList title="O que fazer" items={health.ai.recommendations} />
        </div>
      )}

      {!health.ai && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          {health.aiEnabled
            ? 'Diagnóstico da IA indisponível nesta checagem - a nota acima vem das regras do sistema.'
            : 'Diagnóstico da IA desligado: cadastre sua chave de API no menu "IA". A nota acima vem das regras do sistema.'}
        </p>
      )}
    </div>
  );
}

function AiList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <p className="mb-1 mt-2 text-xs font-medium text-gray-500 dark:text-gray-400">{title}</p>
      <ul className="list-disc space-y-1 pl-4 text-gray-700 dark:text-gray-300">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </>
  );
}
