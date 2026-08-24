import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { InstanceSummary, InstanceUsage } from '../lib/api';
import { useCurrentUser } from '../lib/useCurrentUser';
import { Modal } from '../components/Modal';

const STATUS_LABEL: Record<InstanceSummary['status'], string> = {
  connected: 'Conectado',
  qr_code: 'Aguardando QR',
  connecting: 'Conectando',
  disconnected: 'Desconectado',
};

const STATUS_COLOR: Record<InstanceSummary['status'], string> = {
  connected: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400',
  qr_code: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  connecting: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400',
  disconnected: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
};

const WARMUP_COLOR: Record<InstanceSummary['warmupLevel'], string> = {
  cold: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400',
  warm: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400',
  hot: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400',
};

export function InstancesPage() {
  const queryClient = useQueryClient();
  const { data: me } = useCurrentUser();
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [newInstanceId, setNewInstanceId] = useState('');
  const [testingInstanceId, setTestingInstanceId] = useState<string | null>(null);
  const canDispatchTest = me?.role === 'admin' || me?.canDispatchTest === true;

  const { data: instances, isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: async () => (await api.get<InstanceSummary[]>('/instances')).data,
    refetchInterval: 5000,
  });

  const connectMutation = useMutation({
    mutationFn: (instanceId: string) => api.post(`/instances/${instanceId}/connect`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível conectar essa instância.'),
  });

  const reconnectMutation = useMutation({
    mutationFn: (instanceId: string) => api.post(`/instances/${instanceId}/reconnect`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível reconectar essa instância.'),
  });

  const resetMutation = useMutation({
    mutationFn: (instanceId: string) => api.delete(`/instances/${instanceId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instances'] }),
    onError: (err: any) => alert(err.response?.data?.message || 'Não foi possível limpar a sessão dessa instância.'),
  });

  function startPairing(instanceId: string) {
    setPairingId(instanceId);
    connectMutation.mutate(instanceId);
  }

  function handleReset(instanceId: string) {
    if (
      confirm(
        `Limpar a sessão de "${instanceId}"? O WhatsApp desconectado ficará desvinculado - vai precisar escanear um QR code novo pra reconectar.`,
      )
    ) {
      resetMutation.mutate(instanceId);
    }
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Instâncias</h1>
        <div className="flex flex-wrap gap-2">
          <input
            value={newInstanceId}
            onChange={(e) => setNewInstanceId(e.target.value)}
            placeholder="ex: 5511999999999"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 sm:flex-none"
          />
          <button
            disabled={!newInstanceId}
            onClick={() => startPairing(newInstanceId)}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900"
          >
            Parear nova instância
          </button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-500 dark:text-gray-400">Carregando...</p>}

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-gray-800/50 dark:text-gray-400">
            <tr>
              <th className="px-4 py-2">Instância</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Aquecimento</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {instances?.map((instance) => (
              <tr key={instance.instanceId} className="border-t border-gray-100 dark:border-gray-800">
                <td className="px-4 py-2 font-mono text-gray-900 dark:text-gray-100">{instance.instanceId}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLOR[instance.status]}`}>
                    {STATUS_LABEL[instance.status]}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${WARMUP_COLOR[instance.warmupLevel]}`}>
                    {instance.warmupLevel}
                  </span>
                  {instance.warmupAgeDays !== null && (
                    <span className="ml-2 text-xs text-gray-400 dark:text-gray-500">
                      {instance.warmupAgeDays.toFixed(1)}d
                    </span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => startPairing(instance.instanceId)}
                    className="mr-2 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    Ver QR
                  </button>
                  <button
                    onClick={() => reconnectMutation.mutate(instance.instanceId)}
                    className="mr-2 text-xs text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
                  >
                    Reconectar
                  </button>
                  {canDispatchTest && (
                    <button
                      onClick={() => setTestingInstanceId(instance.instanceId)}
                      className="mr-2 text-xs text-purple-600 hover:text-purple-800 dark:text-purple-400 dark:hover:text-purple-300"
                      title="Reconecta a instância e envia uma mensagem de teste na hora - ferramenta de diagnóstico"
                    >
                      Disparo de teste
                    </button>
                  )}
                  <button
                    onClick={() => handleReset(instance.instanceId)}
                    className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    Limpar sessão
                  </button>
                </td>
              </tr>
            ))}
            {instances?.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-gray-400 dark:text-gray-500">
                  Nenhuma instância ainda. Pareie a primeira acima.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pairingId && <PairingDialog instanceId={pairingId} onClose={() => setPairingId(null)} />}
      {testingInstanceId && (
        <TestDispatchDialog instanceId={testingInstanceId} onClose={() => setTestingInstanceId(null)} />
      )}
    </div>
  );
}

function TestDispatchDialog({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const dispatchMutation = useMutation({
    mutationFn: () => api.post('/test-dispatch', { instanceId, to, text: text.trim() || undefined }),
    onSuccess: () => setResult({ ok: true, message: 'Mensagem de teste enviada. Confira no celular do destinatário se ela carregou normalmente.' }),
    onError: (err: any) =>
      setResult({ ok: false, message: err.response?.data?.message || 'Não foi possível completar o disparo de teste.' }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setResult(null);
    dispatchMutation.mutate();
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <h2 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">Disparo de teste</h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          Instância <span className="font-mono">{instanceId}</span>. Isso reconecta a sessão e envia a mensagem
          imediatamente em seguida (fora do fluxo normal de disparo) - use só pra diagnóstico, não em contatos reais
          de campanha.
        </p>

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Número (com DDI/DDD)</label>
        <input
          value={to}
          onChange={(e) => setTo(e.target.value)}
          required
          placeholder="ex: 5511999999999"
          className="mb-3 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        <label className="mb-1 block text-sm text-gray-600 dark:text-gray-400">Mensagem (opcional)</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="Deixe em branco pra usar a mensagem de teste padrão"
          className="mb-4 w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
        />

        {result && (
          <p
            className={`mb-3 text-sm ${result.ok ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {result.message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-gray-300 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
          >
            Fechar
          </button>
          <button
            type="submit"
            disabled={dispatchMutation.isPending}
            className="flex-1 rounded-md bg-purple-600 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {dispatchMutation.isPending ? 'Disparando...' : 'Disparar teste'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PairingDialog({ instanceId, onClose }: { instanceId: string; onClose: () => void }) {
  const queryClient = useQueryClient();

  const { data: usage } = useQuery({
    queryKey: ['instance-usage', instanceId],
    queryFn: async () => (await api.get<InstanceUsage>(`/instances/${instanceId}/usage`)).data,
    refetchInterval: 5000,
  });

  const { data: status } = useQuery({
    queryKey: ['instance-status', instanceId],
    queryFn: async () => (await api.get<{ status: string; qr?: string }>(`/instances/${instanceId}/status`)).data,
    // QR do WhatsApp expira rápido (~20s) e o Baileys gera um novo sozinho -
    // repolling curto mantém a imagem sempre válida na tela
    refetchInterval: (query) => (query.state.data?.status === 'connected' ? false : 3000),
  });

  if (status?.status === 'connected') {
    queryClient.invalidateQueries({ queryKey: ['instances'] });
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-80 rounded-lg bg-white p-6 text-center shadow-lg dark:bg-gray-900">
        <h2 className="mb-1 font-semibold text-gray-900 dark:text-gray-100">{instanceId}</h2>
        <p className="mb-4 text-sm text-gray-500 dark:text-gray-400">
          {status?.status === 'connected' ? 'Conectado!' : 'Escaneie com WhatsApp → Aparelhos conectados'}
        </p>

        {status?.status === 'connected' && <div className="py-8 text-4xl">✅</div>}

        {status?.qr && status.status !== 'connected' && (
          <img
            src={status.qr}
            alt="QR code"
            className="mx-auto mb-2 w-56 rounded-md border border-gray-200 dark:border-gray-700"
          />
        )}

        {!status?.qr && status?.status !== 'connected' && (
          <p className="py-8 text-sm text-gray-400 dark:text-gray-500">Gerando QR...</p>
        )}

        {usage && (
          <p className="mb-3 text-xs text-gray-400 dark:text-gray-500">
            nível {usage.warmupLevel} · {usage.used.day}/{usage.limits.perDay} hoje
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full rounded-md border border-gray-300 py-1.5 text-sm font-medium text-gray-700 dark:border-gray-700 dark:text-gray-300"
        >
          Fechar
        </button>
      </div>
    </div>
  );
}
