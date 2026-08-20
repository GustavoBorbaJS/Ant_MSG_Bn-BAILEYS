import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { InstanceSummary, MessageLog, MessageStatus, Paginated } from '../lib/api';

const STATUS_LABEL: Record<MessageStatus, string> = { pending: 'Pendente', sent: 'Enviada', failed: 'Falhou' };
const STATUS_COLOR: Record<MessageStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400',
  sent: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

const PAGE_SIZE = 50;

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('pt-BR');
}

export function MessageLogsPage() {
  const [instanceId, setInstanceId] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: async () => (await api.get<InstanceSummary[]>('/instances')).data,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['message-logs', instanceId, status, from, to, page],
    queryFn: async () =>
      (
        await api.get<Paginated<MessageLog>>('/message-logs', {
          params: {
            instanceId: instanceId || undefined,
            status: status || undefined,
            from: from ? new Date(from).toISOString() : undefined,
            to: to ? new Date(to).toISOString() : undefined,
            page,
            pageSize: PAGE_SIZE,
          },
        })
      ).data,
    placeholderData: (prev) => prev,
  });

  function updateFilter(setter: (value: string) => void, value: string) {
    setter(value);
    setPage(1);
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Histórico de mensagens</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Instância</label>
          <select
            value={instanceId}
            onChange={(e) => updateFilter(setInstanceId, e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Todas</option>
            {instances?.map((i) => (
              <option key={i.instanceId} value={i.instanceId}>
                {i.instanceId}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Status</label>
          <select
            value={status}
            onChange={(e) => updateFilter(setStatus, e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Todos</option>
            <option value="pending">Pendente</option>
            <option value="sent">Enviada</option>
            <option value="failed">Falhou</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">De</label>
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => updateFilter(setFrom, e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Até</label>
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => updateFilter(setTo, e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>

        {(instanceId || status || from || to) && (
          <button
            onClick={() => {
              setInstanceId('');
              setStatus('');
              setFrom('');
              setTo('');
              setPage(1);
            }}
            className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">Instância</th>
              <th className="px-4 py-2">Para</th>
              <th className="px-4 py-2">Mensagem</th>
              <th className="px-4 py-2">Campanha</th>
              <th className="px-4 py-2">Modo</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((log) => (
              <tr key={log.id} className="border-t border-gray-100 dark:border-gray-800">
                <td className="whitespace-nowrap px-4 py-2 text-gray-500 dark:text-gray-400">
                  {formatDate(log.createdAt)}
                </td>
                <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{log.instanceId}</td>
                <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">
                  {log.contact ? `${log.contact.name} (${log.to})` : log.to}
                </td>
                <td className="max-w-xs truncate px-4 py-2 text-gray-600 dark:text-gray-400" title={log.text}>
                  {log.text}
                </td>
                <td className="px-4 py-2 text-gray-500 dark:text-gray-400">{log.campaign?.name ?? '—'}</td>
                <td className="px-4 py-2">
                  {log.dispatchMode === 'direct' ? (
                    <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-400">
                      Direto
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[log.status]}`}>
                    {STATUS_LABEL[log.status]}
                  </span>
                  {log.status === 'failed' && log.errorMessage && (
                    <p className="mt-0.5 max-w-xs truncate text-xs text-red-400" title={log.errorMessage}>
                      {log.errorMessage}
                    </p>
                  )}
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">
                  Nenhuma mensagem encontrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {data && data.total > 0 && (
        <div className="mt-3 flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>
            {data.total} mensage{data.total === 1 ? 'm' : 'ns'} · página {page} de {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isFetching}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700"
            >
              Anterior
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isFetching}
              className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700"
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
