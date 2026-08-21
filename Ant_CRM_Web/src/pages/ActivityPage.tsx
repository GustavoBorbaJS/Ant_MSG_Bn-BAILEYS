import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { CrmUser, InstanceSummary, MessageLog, MessageStatus, Paginated } from '../lib/api';

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

// Só admin (rota gateada em App.tsx via AdminRoute) - mostra os envios de
// TODOS os usuários, sem misturar contatos/campanhas de cada um na tela
// principal. Só o essencial pra supervisão: quem, quando, pra qual instância,
// status.
export function ActivityPage() {
  const [dispatchedBy, setDispatchedBy] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => (await api.get<CrmUser[]>('/users')).data,
  });

  const { data: instances } = useQuery({
    queryKey: ['instances'],
    queryFn: async () => (await api.get<InstanceSummary[]>('/instances')).data,
  });

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['message-logs-activity', dispatchedBy, instanceId, status, page],
    queryFn: async () =>
      (
        await api.get<Paginated<MessageLog>>('/message-logs/activity', {
          params: {
            dispatchedBy: dispatchedBy || undefined,
            instanceId: instanceId || undefined,
            status: status || undefined,
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
      <h1 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">Atividade dos usuários</h1>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs text-gray-500 dark:text-gray-400">Usuário</label>
          <select
            value={dispatchedBy}
            onChange={(e) => updateFilter(setDispatchedBy, e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          >
            <option value="">Todos</option>
            {users?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.username})
              </option>
            ))}
          </select>
        </div>

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

        {(dispatchedBy || instanceId || status) && (
          <button
            onClick={() => {
              setDispatchedBy('');
              setInstanceId('');
              setStatus('');
              setPage(1);
            }}
            className="text-sm text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            Limpar filtros
          </button>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Data</th>
              <th className="px-4 py-2">Usuário</th>
              <th className="px-4 py-2">Instância</th>
              <th className="px-4 py-2">Para</th>
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
                <td className="px-4 py-2 text-gray-700 dark:text-gray-300">
                  {log.dispatcher ? `${log.dispatcher.name} (${log.dispatcher.username})` : '—'}
                </td>
                <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{log.instanceId}</td>
                <td className="px-4 py-2 font-mono text-gray-700 dark:text-gray-300">{log.to}</td>
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
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">
                  Nenhuma atividade encontrada.
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
